const Stripe = require("stripe");
const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const paymentRepository = require("./payment.repository");
const jobRepository = require("../jobs/job.repository");
const jobService = require("../jobs/job.service");

class PaymentService {
  getStripeClient() {
    if (!env.stripeSecretKey) {
      throw new AppError("Stripe is not configured", 500);
    }

    return new Stripe(env.stripeSecretKey);
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

    const pricing = this.calculateAmounts(payload.amount || normalizedJobDraft.estimatedPrice || 0);

    if (!pricing.amount) {
      throw new AppError("A valid amount is required to create a payment session", 400);
    }

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
      success_url: `${env.clientUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.clientUrl}/book`,
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

    const isAllowed =
      user.role === ROLES.ADMIN ||
      String(payment.customer?._id || payment.customer) === String(user._id) ||
      String(payment.worker?._id || payment.worker || "") === String(user._id);

    if (!isAllowed) {
      throw new AppError("You do not have access to this payment", 403);
    }

    return payment;
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

    return { received: true };
  }
}

module.exports = new PaymentService();
