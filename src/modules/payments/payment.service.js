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
const RECONCILIATION_LOCK_TIMEOUT_MS = 60 * 1000;

class PaymentService {
  constructor() {
    this.repairIntervalHandle = null;
    this.repairRunInProgress = false;
  }

  normalizeStatusFilter(status = "") {
    const normalizedStatus = String(status).trim().toLowerCase();

    if (!normalizedStatus || normalizedStatus === "all" || normalizedStatus === "all status") {
      return "";
    }

    if (normalizedStatus === "completed") {
      return "paid";
    }

    return normalizedStatus;
  }

  normalizePaymentMethodFilter(paymentMethod = "") {
    const normalizedMethod = String(paymentMethod).trim().toLowerCase();

    if (
      !normalizedMethod ||
      normalizedMethod === "all" ||
      normalizedMethod === "payment method"
    ) {
      return "";
    }

    const methodMap = {
      card: "card",
      "credit card": "card",
      paypal: "paypal",
      cash: "cash",
      bank_transfer: "bank_transfer",
      "bank transfer": "bank_transfer",
    };

    return methodMap[normalizedMethod] || normalizedMethod;
  }

  getPaymentTimestamp(payment) {
    return payment?.paidAt || payment?.authorizedAt || payment?.createdAt || null;
  }

  isInCurrentMonth(value) {
    if (!value) {
      return false;
    }

    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      return false;
    }

    const now = new Date();

    return (
      parsedDate.getUTCFullYear() === now.getUTCFullYear() &&
      parsedDate.getUTCMonth() === now.getUTCMonth()
    );
  }

  getDateRangeStart(dateRange = "") {
    const normalizedRange = String(dateRange).trim().toLowerCase();
    const daysByRange = {
      last_7_days: 7,
      "last 7 days": 7,
      last_30_days: 30,
      "last 30 days": 30,
      last_3_months: 90,
      "last 3 months": 90,
      last_year: 365,
      "last year": 365,
    };

    const days = daysByRange[normalizedRange];

    if (!days) {
      return null;
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (days - 1));

    return startDate;
  }

  matchesSearch(payment, search = "") {
    const normalizedSearch = String(search).trim().toLowerCase();

    if (!normalizedSearch) {
      return true;
    }

    const paymentId = String(payment?._id || "");
    const jobId = String(payment?.job?._id || "");
    const shortPaymentId = paymentId ? `#pay-${paymentId.slice(-6)}` : "";
    const shortJobId = jobId ? `#job-${jobId.slice(-6)}` : "";

    const searchableValues = [
      paymentId,
      jobId,
      shortPaymentId,
      shortJobId,
      payment?.job?.title,
      payment?.job?.serviceType,
      payment?.worker?.name,
      payment?.worker?.email,
      payment?.customer?.name,
      payment?.customer?.email,
      payment?.description,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return searchableValues.some((value) => value.includes(normalizedSearch));
  }

  matchesSpecificDate(payment, exactDate = "") {
    const normalizedDate = String(exactDate).trim();

    if (!normalizedDate) {
      return true;
    }

    const paymentTimestamp = this.getPaymentTimestamp(payment);

    if (!paymentTimestamp) {
      return false;
    }

    return new Date(paymentTimestamp).toISOString().slice(0, 10) === normalizedDate;
  }

  matchesDateRange(payment, dateRange = "") {
    const startDate = this.getDateRangeStart(dateRange);

    if (!startDate) {
      return true;
    }

    const paymentTimestamp = this.getPaymentTimestamp(payment);

    if (!paymentTimestamp) {
      return false;
    }

    return new Date(paymentTimestamp) >= startDate;
  }

  buildPaymentsSummary(items = []) {
    const sortedPayments = [...items].sort(
      (left, right) =>
        new Date(this.getPaymentTimestamp(right) || 0).getTime() -
        new Date(this.getPaymentTimestamp(left) || 0).getTime()
    );
    const paidPayments = sortedPayments.filter((payment) => payment?.status === "paid");
    const earningEligiblePayments = sortedPayments.filter((payment) =>
      ["paid", "authorized", "pending"].includes(payment?.status)
    );
    const pendingPayments = items.filter((payment) =>
      ["pending", "authorized"].includes(payment?.status)
    );
    const currentMonthPayments = earningEligiblePayments.filter((payment) =>
      this.isInCurrentMonth(this.getPaymentTimestamp(payment))
    );
    const latestPaidPayment = paidPayments[0] || null;

    return {
      totalAmount: items.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0),
      totalPaid: paidPayments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0),
      totalPlatformFee: items.reduce(
        (sum, payment) => sum + Number(payment?.platformFee || 0),
        0
      ),
      totalWorkerPayout: items.reduce(
        (sum, payment) => sum + Number(payment?.workerPayout || 0),
        0
      ),
      totalPaidWorkerPayout: paidPayments.reduce(
        (sum, payment) => sum + Number(payment?.workerPayout || 0),
        0
      ),
      pendingWorkerPayout: pendingPayments.reduce(
        (sum, payment) => sum + Number(payment?.workerPayout || 0),
        0
      ),
      currentMonthWorkerPayout: currentMonthPayments.reduce(
        (sum, payment) => sum + Number(payment?.workerPayout || 0),
        0
      ),
      pendingPayments: pendingPayments.reduce(
        (sum, payment) => sum + Number(payment?.amount || 0),
        0
      ),
      pendingCount: pendingPayments.length,
      paidCount: paidPayments.length,
      lastPaymentAmount: Number(latestPaidPayment?.amount || 0),
      lastPaymentDate: this.getPaymentTimestamp(latestPaidPayment),
      totalCount: items.length,
    };
  }

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

  buildStripeSyncUpdate(context = {}, extra = {}, timestamp = new Date()) {
    const update = {
      stripeLastSyncedAt: timestamp,
      ...extra,
    };

    if (context.stripeEventId) {
      update.stripeLastEventId = context.stripeEventId;
    }

    if (context.stripeEventType) {
      update.stripeLastEventType = context.stripeEventType;
    }

    if (context.source === "background_repair") {
      update.lastRepairAttemptAt = timestamp;
    }

    return update;
  }

  normalizeRepairErrorMessage(error) {
    return String(error?.message || error || "Unknown Stripe repair error").slice(0, 500);
  }

  isStripeRepairEnabled() {
    return Boolean(env.stripeRepairEnabled && env.stripeSecretKey);
  }

  getRepairIntervalMs() {
    return Math.max(5000, Number(env.stripeRepairIntervalMs) || 30000);
  }

  getRepairBatchSize() {
    return Math.max(1, Number(env.stripeRepairBatchSize) || 10);
  }

  getRepairMinAgeMs() {
    return Math.max(0, Number(env.stripeRepairMinAgeMs) || 0);
  }

  getStripeCaptureExpiry(paymentIntent) {
    const captureBefore =
      paymentIntent?.latest_charge?.payment_method_details?.card?.capture_before || null;

    if (!captureBefore) {
      return null;
    }

    const parsedDate = new Date(Number(captureBefore) * 1000);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  async retrievePaymentIntent(paymentIntentId) {
    if (!paymentIntentId) {
      return null;
    }

    return this.getStripeClient().paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
  }

  async findOrCreateJobForPayment(payment, { paymentStatus = "pending", isPaid = false } = {}) {
    if (payment?.job) {
      const existingJob = await jobRepository.findById(payment.job);

      if (existingJob) {
        return existingJob;
      }
    }

    const existingSourceJob = await jobRepository.findOne({
      sourcePayment: payment._id,
    });

    if (existingSourceJob) {
      return existingSourceJob;
    }

    const draftJob = payment?.metadata?.draftJob;

    if (!draftJob) {
      throw new AppError("Draft job payload is missing from payment metadata", 500);
    }

    try {
      return await jobRepository.create({
        ...draftJob,
        sourcePayment: payment._id,
        isPaid,
        paymentStatus,
        status: "new",
      });
    } catch (error) {
      if (error?.code === 11000) {
        const createdJob = await jobRepository.findOne({
          sourcePayment: payment._id,
        });

        if (createdJob) {
          return createdJob;
        }
      }

      throw error;
    }
  }

  async syncJobPaymentState(jobId, { paymentStatus, isPaid }) {
    if (!jobId) {
      return null;
    }

    return jobRepository.updateById(jobId, {
      paymentStatus,
      isPaid,
    });
  }

  async reconcileAuthorizedCheckoutSession(payment, session, paymentIntent, context = {}) {
    const lock = await paymentRepository.acquireReconciliationLock(
      payment._id,
      new Date(Date.now() - RECONCILIATION_LOCK_TIMEOUT_MS)
    );

    if (!lock) {
      return {
        status: "locked",
        paymentId: String(payment._id),
        sessionId: session.id,
      };
    }

    const syncedAt = new Date();

    try {
      const latestPayment = await paymentRepository.findById(payment._id);

      if (!latestPayment) {
        return {
          status: "payment_not_found",
          paymentId: String(payment._id),
          sessionId: session.id,
        };
      }

      if (latestPayment.status === "paid") {
        return {
          status: "already_paid",
          paymentId: String(latestPayment._id),
          jobId: String(latestPayment.job || ""),
          sessionId: session.id,
        };
      }

      const ensuredJob = await this.findOrCreateJobForPayment(latestPayment, {
        paymentStatus: "authorized",
        isPaid: false,
      });
      const jobId = ensuredJob?._id || latestPayment.job || null;

      await this.syncJobPaymentState(jobId, {
        paymentStatus: "authorized",
        isPaid: false,
      });

      const updatedPayment = await paymentRepository.updateById(
        latestPayment._id,
        this.buildStripeSyncUpdate(
          context,
          {
            job: jobId,
            status: "authorized",
            authorizedAt: latestPayment.authorizedAt || syncedAt,
            authorizationExpiresAt:
              this.getStripeCaptureExpiry(paymentIntent) ||
              latestPayment.authorizationExpiresAt ||
              null,
            stripePaymentIntentId:
              paymentIntent?.id ||
              session.payment_intent ||
              latestPayment.stripePaymentIntentId ||
              "",
            stripeCustomerId:
              paymentIntent?.customer || session.customer || latestPayment.stripeCustomerId || "",
            stripePaymentMethodId:
              paymentIntent?.payment_method || latestPayment.stripePaymentMethodId || "",
            paymentMethod:
              latestPayment.paymentMethod && latestPayment.paymentMethod !== "unknown"
                ? latestPayment.paymentMethod
                : "card",
            lastRepairError: "",
            lastCaptureError: "",
          },
          syncedAt
        )
      );

      return {
        status:
          latestPayment.status === "authorized" && latestPayment.job
            ? "already_authorized"
            : "authorized",
        paymentId: String(updatedPayment._id),
        jobId: String(jobId),
        sessionId: session.id,
      };
    } finally {
      await paymentRepository.releaseReconciliationLock(payment._id);
    }
  }

  async reconcilePaidCheckoutSession(payment, session, paymentIntent = null, context = {}) {
    const lock = await paymentRepository.acquireReconciliationLock(
      payment._id,
      new Date(Date.now() - RECONCILIATION_LOCK_TIMEOUT_MS)
    );

    if (!lock) {
      return {
        status: "locked",
        paymentId: String(payment._id),
        sessionId: session?.id || "",
      };
    }

    const syncedAt = new Date();

    try {
      const latestPayment = await paymentRepository.findById(payment._id);

      if (!latestPayment) {
        return {
          status: "payment_not_found",
          paymentId: String(payment._id),
          sessionId: session?.id || "",
        };
      }

      const ensuredJob = await this.findOrCreateJobForPayment(latestPayment, {
        paymentStatus: "paid",
        isPaid: true,
      });
      const jobId = ensuredJob?._id || latestPayment.job || null;

      await this.syncJobPaymentState(jobId, {
        paymentStatus: "paid",
        isPaid: true,
      });

      const updatedPayment = await paymentRepository.updateById(
        latestPayment._id,
        this.buildStripeSyncUpdate(
          context,
          {
            job: jobId,
            status: "paid",
            paidAt: latestPayment.paidAt || syncedAt,
            authorizedAt: latestPayment.authorizedAt || syncedAt,
            authorizationExpiresAt:
              this.getStripeCaptureExpiry(paymentIntent) ||
              latestPayment.authorizationExpiresAt ||
              null,
            captureAttemptedAt: latestPayment.captureAttemptedAt || syncedAt,
            stripePaymentIntentId:
              paymentIntent?.id ||
              session?.payment_intent ||
              latestPayment.stripePaymentIntentId ||
              "",
            stripeCustomerId:
              paymentIntent?.customer ||
              session?.customer ||
              latestPayment.stripeCustomerId ||
              "",
            stripePaymentMethodId:
              paymentIntent?.payment_method || latestPayment.stripePaymentMethodId || "",
            paymentMethod:
              latestPayment.paymentMethod && latestPayment.paymentMethod !== "unknown"
                ? latestPayment.paymentMethod
                : "card",
            lastRepairError: "",
            lastCaptureError: "",
          },
          syncedAt
        )
      );

      return {
        status:
          latestPayment.status === "paid" && latestPayment.job ? "already_paid" : "paid",
        paymentId: String(updatedPayment._id),
        jobId: String(jobId),
        sessionId: session?.id || "",
      };
    } finally {
      await paymentRepository.releaseReconciliationLock(payment._id);
    }
  }

  async reconcileCheckoutSession(session, context = {}) {
    if (!session?.id) {
      throw new AppError("Stripe checkout session id is required for reconciliation", 500);
    }

    const payment = await paymentRepository.findBySessionId(session.id);

    if (!payment) {
      logger.warn({ sessionId: session.id }, "Stripe checkout session has no local payment record");

      return {
        status: "payment_not_found",
        sessionId: session.id,
      };
    }

    let paymentIntent = null;

    if (session.payment_intent) {
      try {
        paymentIntent = await this.retrievePaymentIntent(session.payment_intent);
      } catch (error) {
        logger.warn(
          {
            err: error,
            sessionId: session.id,
            paymentIntentId: session.payment_intent,
          },
          "Unable to retrieve Stripe payment intent while reconciling checkout session"
        );
      }
    }

    if (paymentIntent?.status === "requires_capture") {
      return this.reconcileAuthorizedCheckoutSession(payment, session, paymentIntent, context);
    }

    if (paymentIntent?.status === "succeeded") {
      return this.reconcilePaidCheckoutSession(payment, session, paymentIntent, context);
    }

    if (session.status === "expired") {
      const syncedAt = new Date();
      const cancelledPayment = await paymentRepository.updateOne(
        { _id: payment._id, status: "pending" },
        this.buildStripeSyncUpdate(
          context,
          {
            status: "cancelled",
            lastRepairError: "",
          },
          syncedAt
        )
      );

      return {
        status: cancelledPayment ? "cancelled" : payment.status,
        paymentId: String(payment._id),
        sessionId: session.id,
      };
    }

    if (context.source === "background_repair") {
      await paymentRepository.updateById(
        payment._id,
        this.buildStripeSyncUpdate(
          context,
          {
            lastRepairError: "",
          },
          new Date()
        )
      );
    }

    return {
      status: payment.status,
      paymentId: String(payment._id),
      sessionId: session.id,
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
      customer_creation: "always",
      customer_email: normalizedJobDraft.email,
      payment_method_types: ["card"],
      payment_intent_data: {
        capture_method: "manual",
        setup_future_usage: "off_session",
        metadata: {
          paymentRecordId: String(paymentRecord._id),
        },
      },
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
        paymentFlow: "authorize_then_capture",
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
    const normalizedStatus = this.normalizeStatusFilter(query.status);
    const normalizedPaymentMethod = this.normalizePaymentMethodFilter(
      query.paymentMethod || query.method
    );

    if (normalizedStatus) {
      filter.status = normalizedStatus;
    }

    if (query.gateway) {
      filter.gateway = query.gateway;
    }

    if (normalizedPaymentMethod) {
      filter.paymentMethod = normalizedPaymentMethod;
    }

    if (user.role === ROLES.CUSTOMER) {
      filter.customer = user._id;
    } else if (user.role === ROLES.WORKER) {
      filter.worker = user._id;
    }

    const items = await paymentRepository.findMany(filter, {
      populate: paymentRepository.buildRelationsPopulate(),
      sort: { createdAt: -1 },
      lean: true,
    });

    const filteredItems = items.filter(
      (payment) =>
        this.matchesSearch(payment, query.search) &&
        this.matchesSpecificDate(payment, query.date) &&
        this.matchesDateRange(payment, query.dateRange)
    );

    const startIndex = (pagination.page - 1) * pagination.limit;
    const paginatedItems = filteredItems.slice(startIndex, startIndex + pagination.limit);

    return {
      items: paginatedItems,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: filteredItems.length,
        totalPages: Math.ceil(filteredItems.length / pagination.limit) || 1,
      },
      summary: this.buildPaymentsSummary(filteredItems),
    };
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

    let payment = await paymentRepository.findBySessionIdWithRelations(sessionId);

    if (!payment) {
      throw new AppError("Checkout session not found", 404);
    }

    this.assertPaymentAccess(user, payment);

    const stripe = this.getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (payment.status !== "paid") {
      await this.reconcileCheckoutSession(session, {
        source: "status_check",
      });

      payment = await paymentRepository.findBySessionIdWithRelations(sessionId);
    }

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

  async captureAuthorizedPaymentForBooking(booking, context = {}) {
    const bookingId = booking?._id || booking;
    const jobId = booking?.job?._id || booking?.job || null;
    const payment = await paymentRepository.findOne({
      $or: [
        ...(bookingId ? [{ booking: bookingId }] : []),
        ...(jobId ? [{ job: jobId }] : []),
      ],
    });

    if (!payment) {
      return {
        status: "payment_not_found",
        bookingId: String(bookingId || ""),
        jobId: String(jobId || ""),
      };
    }

    if (payment.status === "paid") {
      return {
        status: "already_paid",
        paymentId: String(payment._id),
        bookingId: String(bookingId || ""),
        jobId: String(jobId || payment.job || ""),
      };
    }

    const stripe = this.getStripeClient();
    const attemptedAt = new Date();

    try {
      let paymentIntent = payment.stripePaymentIntentId
        ? await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, {
            expand: ["latest_charge"],
          })
        : null;

      if (paymentIntent?.status === "requires_capture") {
        paymentIntent = await stripe.paymentIntents.capture(paymentIntent.id);
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent.id, {
          expand: ["latest_charge"],
        });

        return this.reconcilePaidCheckoutSession(
          payment,
          {
            id: payment.stripeCheckoutSessionId || `capture_${payment._id}`,
            payment_intent: paymentIntent.id,
            customer: paymentIntent.customer || payment.stripeCustomerId || "",
          },
          paymentIntent,
          {
            ...context,
            source: "booking_completion",
          }
        );
      }

      if (paymentIntent?.status === "succeeded") {
        return this.reconcilePaidCheckoutSession(
          payment,
          {
            id: payment.stripeCheckoutSessionId || `capture_${payment._id}`,
            payment_intent: paymentIntent.id,
            customer: paymentIntent.customer || payment.stripeCustomerId || "",
          },
          paymentIntent,
          {
            ...context,
            source: "booking_completion",
          }
        );
      }

      if (payment.stripeCustomerId && payment.stripePaymentMethodId) {
        paymentIntent = await stripe.paymentIntents.create(
          {
            amount: Math.round(Number(payment.amount || 0) * 100),
            currency: String(payment.currency || "usd").toLowerCase(),
            customer: payment.stripeCustomerId,
            payment_method: payment.stripePaymentMethodId,
            confirm: true,
            off_session: true,
            description: payment.description || "Yard Heroes completion charge",
            metadata: {
              paymentRecordId: String(payment._id),
              bookingId: String(bookingId || ""),
              jobId: String(jobId || payment.job || ""),
              paymentFlow: "authorize_then_capture_fallback",
            },
          },
          {
            idempotencyKey: `payment_capture_${payment._id}_${bookingId || jobId || "job"}`,
          }
        );

        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent.id, {
          expand: ["latest_charge"],
        });

        return this.reconcilePaidCheckoutSession(
          payment,
          {
            id: payment.stripeCheckoutSessionId || `fallback_${payment._id}`,
            payment_intent: paymentIntent.id,
            customer: paymentIntent.customer || payment.stripeCustomerId || "",
          },
          paymentIntent,
          {
            ...context,
            source: "booking_completion",
          }
        );
      }

      throw new AppError("No usable Stripe authorization or saved payment method was found", 409);
    } catch (error) {
      await paymentRepository.updateById(payment._id, {
        status: "failed",
        captureAttemptedAt: attemptedAt,
        lastCaptureError: this.normalizeRepairErrorMessage(error),
      });

      await this.syncJobPaymentState(jobId || payment.job, {
        paymentStatus: "failed",
        isPaid: false,
      });

      logger.error(
        {
          err: error,
          paymentId: payment._id,
          bookingId,
          jobId: jobId || payment.job,
        },
        "Stripe payment capture failed after booking completion"
      );

      return {
        status: "failed",
        paymentId: String(payment._id),
        bookingId: String(bookingId || ""),
        jobId: String(jobId || payment.job || ""),
        errorMessage: this.normalizeRepairErrorMessage(error),
      };
    }
  }

  async repairPendingStripePayments() {
    if (!this.isStripeRepairEnabled()) {
      return {
        enabled: false,
        scanned: 0,
        repaired: 0,
        cancelled: 0,
        pending: 0,
        failed: 0,
        locked: 0,
      };
    }

    const candidates = await paymentRepository.findPendingStripePaymentsForRepair(
      new Date(Date.now() - this.getRepairMinAgeMs()),
      this.getRepairBatchSize()
    );

    if (!candidates.length) {
      return {
        enabled: true,
        scanned: 0,
        repaired: 0,
        cancelled: 0,
        pending: 0,
        failed: 0,
        locked: 0,
      };
    }

    const stripe = this.getStripeClient();
    const summary = {
      enabled: true,
      scanned: candidates.length,
      repaired: 0,
      cancelled: 0,
      pending: 0,
      failed: 0,
      locked: 0,
    };

    for (const payment of candidates) {
      try {
        const session = await stripe.checkout.sessions.retrieve(payment.stripeCheckoutSessionId);
        const result = await this.reconcileCheckoutSession(session, {
          source: "background_repair",
        });

        if (["authorized", "already_authorized", "paid", "already_paid"].includes(result.status)) {
          summary.repaired += 1;
          continue;
        }

        if (result.status === "cancelled") {
          summary.cancelled += 1;
          continue;
        }

        if (result.status === "locked") {
          summary.locked += 1;
          continue;
        }

        summary.pending += 1;
      } catch (error) {
        summary.failed += 1;

        await paymentRepository.updateById(payment._id, {
          lastRepairAttemptAt: new Date(),
          lastRepairError: this.normalizeRepairErrorMessage(error),
        });

        logger.warn(
          {
            err: error,
            paymentId: payment._id,
            sessionId: payment.stripeCheckoutSessionId,
          },
          "Stripe payment repair attempt failed"
        );
      }
    }

    return summary;
  }

  startBackgroundRepairLoop() {
    if (!this.isStripeRepairEnabled()) {
      logger.info("Stripe background repair loop is disabled");
      return;
    }

    if (this.repairIntervalHandle) {
      return;
    }

    const runRepairPass = async (trigger) => {
      if (this.repairRunInProgress) {
        return;
      }

      this.repairRunInProgress = true;

      try {
        const summary = await this.repairPendingStripePayments();

        if (summary.scanned > 0 || summary.failed > 0 || trigger === "startup") {
          logger.info({ trigger, ...summary }, "Stripe payment repair pass completed");
        }
      } catch (error) {
        logger.error({ err: error, trigger }, "Stripe payment repair pass failed");
      } finally {
        this.repairRunInProgress = false;
      }
    };

    const startupTimeout = setTimeout(() => {
      runRepairPass("startup");
    }, Math.max(0, Number(env.stripeRepairStartupDelayMs) || 0));
    startupTimeout.unref?.();

    this.repairIntervalHandle = setInterval(() => {
      runRepairPass("interval");
    }, this.getRepairIntervalMs());
    this.repairIntervalHandle.unref?.();

    logger.info(
      {
        intervalMs: this.getRepairIntervalMs(),
        batchSize: this.getRepairBatchSize(),
        minAgeMs: this.getRepairMinAgeMs(),
      },
      "Stripe background repair loop started"
    );
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
      await this.reconcileCheckoutSession(event.data.object, {
        source: "webhook",
        stripeEventId: event.id,
        stripeEventType: event.type,
      });
    }

    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object;
      const failedPayment = await paymentRepository.updateOne(
        { stripePaymentIntentId: paymentIntent.id },
        this.buildStripeSyncUpdate(
          {
            source: "webhook",
            stripeEventId: event.id,
            stripeEventType: event.type,
          },
          {
            status: "failed",
            captureAttemptedAt: new Date(),
            lastCaptureError: this.normalizeRepairErrorMessage(
              paymentIntent?.last_payment_error?.message || "Stripe payment failed"
            ),
          },
          new Date()
        )
      );

      if (failedPayment?.job) {
        await this.syncJobPaymentState(failedPayment.job, {
          paymentStatus: "failed",
          isPaid: false,
        });
      }
    }

    if (event.type === "checkout.session.expired") {
      await this.reconcileCheckoutSession(event.data.object, {
        source: "webhook",
        stripeEventId: event.id,
        stripeEventType: event.type,
      });
    }

    return { received: true };
  }
}

module.exports = new PaymentService();
