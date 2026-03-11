const Stripe = require("stripe");
const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const paymentRepository = require("./payment.repository");
const jobRepository = require("../jobs/job.repository");
const jobService = require("../jobs/job.service");
const contentRepository = require("../content/content.repository");

const PRICING_CONTENT_KEY = "pricing-services";
const DEFAULT_SERVICE_PRICES = {
  "yard-lawn-mowing": 40,
  "yard-weed-removal": 35,
  "yard-leaf-cleanup": 45,
  "yard-general-cleanup": 75,
  "yard-hedge-trimming": 50,
  "yard-bush-trimming": 45,
  "yard-garden-bed-cleanup": 60,
  "yard-mulching": 80,
  "yard-snow-shoveling": 35,
  "yard-storm-cleanup": 90,
  "pet-waste-removal": 25,
  "pet-yard-sanitizing": 40,
  "pet-litter-cleanup": 30,
  "vehicle-gas-filling": 15,
  "vehicle-washer-fluid": 15,
  "vehicle-tire-air": 15,
  "vehicle-exterior-wash": 30,
  "vehicle-interior-vacuuming": 25,
  "home-trash-bin-cleaning": 25,
  "home-pressure-washing": 80,
  "home-gutter-removal": 60,
  "home-window-washing": 40,
  "home-patio-sweeping": 35,
};
const DEFAULT_BOOKING_AMOUNT = 45;

class PaymentService {
  getStripeClient() {
    if (!env.stripeSecretKey) {
      throw new AppError("Stripe is not configured", 500);
    }

    return new Stripe(env.stripeSecretKey);
  }

  getClientOrigin() {
    return new URL(env.clientUrl).origin;
  }

  resolveClientReturnUrl(rawUrl, fallbackPath) {
    const fallbackUrl = new URL(fallbackPath, env.clientUrl);

    if (!rawUrl) {
      return fallbackUrl.toString();
    }

    try {
      const resolvedUrl = rawUrl.startsWith("/")
        ? new URL(rawUrl, env.clientUrl)
        : new URL(rawUrl);

      if (resolvedUrl.origin !== this.getClientOrigin()) {
        return fallbackUrl.toString();
      }

      return resolvedUrl.toString();
    } catch {
      return fallbackUrl.toString();
    }
  }

  buildCheckoutSuccessUrl() {
    const successUrl = new URL("/book/success", env.clientUrl);
    return `${successUrl.origin}${successUrl.pathname}?session_id={CHECKOUT_SESSION_ID}`;
  }

  async resolveCheckoutAmount(payload, normalizedJobDraft) {
    const requestedServiceId =
      payload.jobData?.serviceId ||
      payload.serviceId ||
      normalizedJobDraft.serviceType ||
      "";
    const fallbackAmount = Number(payload.amount || normalizedJobDraft.estimatedPrice || 0);

    try {
      const pricingContent = await contentRepository.findByKey(PRICING_CONTENT_KEY);
      const pricingCategories = pricingContent?.value?.categories;

      if (Array.isArray(pricingCategories)) {
        for (const category of pricingCategories) {
          const matchedService = Array.isArray(category?.services)
            ? category.services.find((service) => service?.id === requestedServiceId)
            : null;

          if (matchedService) {
            const servicePrice = Number(matchedService.price || 0);

            if (servicePrice > 0) {
              return servicePrice;
            }
          }
        }
      }
    } catch (error) {
      logger.warn({ err: error }, "Unable to resolve live pricing content for checkout");
    }

    if (DEFAULT_SERVICE_PRICES[requestedServiceId]) {
      return DEFAULT_SERVICE_PRICES[requestedServiceId];
    }

    return fallbackAmount || DEFAULT_BOOKING_AMOUNT;
  }

  calculateAmounts(amount) {
    const numericAmount = Number(amount || 0);
    const platformFeePercentage = env.defaultPlatformFeePercentage;
    const platformFee = Number(((numericAmount * platformFeePercentage) / 100).toFixed(2));
    const workerPayout = Number((numericAmount - platformFee).toFixed(2));

    return {
      amount: numericAmount,
      platformFeePercentage,
      platformFee,
      workerPayout,
    };
  }

  async createJobCheckoutSession(user, payload) {
    if (![ROLES.CUSTOMER, ROLES.ADMIN].includes(user.role)) {
      throw new AppError("Only customers and admins can create checkout sessions", 403);
    }

    const normalizedJobDraft = jobService.mapCreatePayload(user, payload.jobData || payload);
    jobService.validateCreatePayload(normalizedJobDraft);

    const checkoutAmount = await this.resolveCheckoutAmount(payload, normalizedJobDraft);
    const pricing = this.calculateAmounts(checkoutAmount);

    if (!pricing.amount) {
      throw new AppError("A valid amount is required to create a payment session", 400);
    }

    normalizedJobDraft.estimatedPrice = pricing.amount;

    const paymentRecord = await paymentRepository.create({
      customer: user._id,
      amount: pricing.amount,
      currency: payload.currency || "USD",
      platformFeePercentage: pricing.platformFeePercentage,
      platformFee: pricing.platformFee,
      workerPayout: pricing.workerPayout,
      status: "pending",
      gateway: "stripe",
      paymentMethod: "card",
      description: payload.description || `${normalizedJobDraft.title} booking payment`,
      metadata: {
        draftJob: normalizedJobDraft,
      },
    });

    const stripe = this.getStripeClient();
    const cancelUrl = this.resolveClientReturnUrl(payload.cancelUrl, "/book");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: (payload.currency || "usd").toLowerCase(),
            product_data: {
              name: normalizedJobDraft.title,
              description: normalizedJobDraft.jobDescription,
            },
            unit_amount: Math.round(pricing.amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: this.buildCheckoutSuccessUrl(),
      cancel_url: cancelUrl,
      metadata: {
        paymentRecordId: String(paymentRecord._id),
      },
    });

    const updatedPayment = await paymentRepository.updateById(paymentRecord._id, {
      stripeCheckoutSessionId: session.id,
      checkoutUrl: session.url,
    });

    return {
      payment: updatedPayment,
      url: session.url,
      sessionId: session.id,
    };
  }

  assertPaymentAccess(user, payment) {
    const isAllowed =
      user.role === ROLES.ADMIN ||
      String(payment.customer?._id || payment.customer) === String(user._id) ||
      String(payment.worker?._id || payment.worker || "") === String(user._id);

    if (!isAllowed) {
      throw new AppError("You do not have access to this payment", 403);
    }
  }

  async listPayments(user, query = {}) {
    const pagination = buildPagination(query);
    const filter = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.gateway) {
      filter.gateway = query.gateway;
    }

    if (user.role === ROLES.CUSTOMER) {
      filter.customer = user._id;
    } else if (user.role === ROLES.WORKER) {
      filter.worker = user._id;
    }

    return paymentRepository.paginateWithRelations(filter, {
      ...pagination,
      sort: { createdAt: -1 },
    });
  }

  async getPaymentById(user, paymentId) {
    const payment = await paymentRepository.findById(paymentId, {
      populate: [
        { path: "job" },
        { path: "booking" },
        { path: "customer", select: "name email phone" },
        { path: "worker", select: "name email phone" },
      ],
    });

    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    this.assertPaymentAccess(user, payment);

    return payment;
  }

  async getCheckoutSessionStatus(user, sessionId) {
    if (!sessionId) {
      throw new AppError("Checkout session id is required", 400);
    }

    const payment = await paymentRepository.findBySessionIdWithRelations(sessionId);

    if (!payment) {
      throw new AppError("Checkout session not found", 404);
    }

    this.assertPaymentAccess(user, payment);

    const stripe = this.getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return {
      payment,
      job: payment.job || null,
      draftJob: payment.metadata?.draftJob || null,
      checkout: {
        id: session.id,
        status: session.status || "",
        paymentStatus: session.payment_status || "",
        customerEmail:
          session.customer_details?.email || payment.metadata?.draftJob?.email || "",
      },
    };
  }

  async handleStripeWebhook(rawBody, signature) {
    const stripe = this.getStripeClient();

    if (!env.stripeWebhookSecret) {
      throw new AppError("Stripe webhook secret is not configured", 500);
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
    } catch (error) {
      logger.error({ err: error }, "Stripe webhook signature validation failed");
      throw new AppError(`Webhook Error: ${error.message}`, 400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const payment = await paymentRepository.findBySessionId(session.id);

      if (payment && payment.status !== "paid") {
        const draftJob = payment.metadata?.draftJob;

        if (!draftJob) {
          throw new AppError("Draft job payload is missing from payment metadata", 500);
        }

        const createdJob = await jobRepository.create({
          ...draftJob,
          isPaid: true,
          paymentStatus: "paid",
          status: "new",
        });

        await paymentRepository.updateById(payment._id, {
          job: createdJob._id,
          status: "paid",
          paidAt: new Date(),
          stripePaymentIntentId: session.payment_intent || "",
          paymentMethod: "card",
        });
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object;
      await paymentRepository.updateOne(
        { stripePaymentIntentId: paymentIntent.id },
        { status: "failed" }
      );
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      await paymentRepository.updateOne(
        { stripeCheckoutSessionId: session.id, status: "pending" },
        { status: "cancelled" }
      );
    }

    return { received: true };
  }
}

module.exports = new PaymentService();
