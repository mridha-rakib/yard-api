const crypto = require("crypto");
const Stripe = require("stripe");
const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const {
  buildRoleMembershipFilter,
  combineMongoFilters,
  hasAnyRole,
  hasRole,
} = require("../../utils/user-roles");
const { isWorkerPayoutReady } = require("../../utils/worker-payouts");
const paymentRepository = require("./payment.repository");
const jobRepository = require("../jobs/job.repository");
const jobService = require("../jobs/job.service");
const notificationService = require("../notifications/notification.service");
const emailService = require("../../services/email.service");
const userRepository = require("../users/user.repository");
const {
  calculateBundleQuote,
  calculateQuote,
  findServiceDefinition,
  getPricingConfig,
} = require("./pricing-engine");
const stripeWebhookEventRepository = require("./stripe-webhook-event.repository");

const RECONCILIATION_LOCK_TIMEOUT_MS = 60 * 1000;
const REUSABLE_PENDING_CHECKOUT_WINDOW_MS = 10 * 60 * 1000;
const WEBHOOK_EVENT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const WEBHOOK_EVENT_BATCH_SIZE = 10;
const WEBHOOK_EVENT_INTERVAL_MS = 15 * 1000;

const firstNonEmptyArray = (...values) =>
  values.find((value) => Array.isArray(value) && value.length > 0) || [];

const firstNonEmptyObject = (...values) =>
  values.find(
    (value) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0
  ) || {};

class PaymentService {
  constructor() {
    this.repairIntervalHandle = null;
    this.repairRunInProgress = false;
    this.webhookIntervalHandle = null;
    this.webhookRunInProgress = false;
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
    return payment?.refundedAt || payment?.paidAt || payment?.authorizedAt || payment?.createdAt || null;
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
      payment?.stripeLatestRefundId,
      payment?.stripeDisputeId,
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
      totalHeroPayout: items.reduce(
        (sum, payment) => sum + Number(payment?.workerPayout || 0),
        0
      ),
      totalPaidHeroPayout: paidPayments.reduce(
        (sum, payment) => sum + Number(payment?.workerPayout || 0),
        0
      ),
      pendingHeroPayout: pendingPayments.reduce(
        (sum, payment) => sum + Number(payment?.workerPayout || 0),
        0
      ),
      currentMonthHeroPayout: currentMonthPayments.reduce(
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

  constructStripeWebhookEvent(rawBody, signature) {
    if (!env.stripeWebhookSecret) {
      throw new AppError("Stripe webhook secret is not configured", 500);
    }

    try {
      return this.getStripeClient().webhooks.constructEvent(
        rawBody,
        signature,
        env.stripeWebhookSecret
      );
    } catch (error) {
      logger.error({ err: error }, "Stripe webhook signature validation failed");
      throw new AppError(`Webhook Error: ${error.message}`, 400);
    }
  }

  async enqueueStripeWebhookEvent(rawBody, signature) {
    const event = this.constructStripeWebhookEvent(rawBody, signature);
    const storedEvent = await stripeWebhookEventRepository.upsertPendingEvent(event);

    setImmediate(() => {
      this.processPendingStripeWebhookEvents("enqueue");
    });

    return {
      received: true,
      eventId: storedEvent.stripeEventId,
      eventType: storedEvent.type,
    };
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

  async getPublicPricingRules() {
    const config = await getPricingConfig();

    return {
      ...config,
      categories: config.categories.map((category) => ({
        ...category,
        services: category.services.filter((service) => service.isActive !== false),
      })),
    };
  }

  isAuthorizationExpired(paymentIntent = null, payment = null) {
    const expiresAt =
      this.getStripeCaptureExpiry(paymentIntent) ||
      payment?.authorizationExpiresAt ||
      null;

    if (!expiresAt) {
      return false;
    }

    return new Date(expiresAt).getTime() <= Date.now();
  }

  async resolveCheckoutQuote(payload, normalizedJobDraft) {
    const bundleServiceIds = firstNonEmptyArray(
      payload.jobData?.bundleServiceIds || [],
      payload.bundleServiceIds || [],
      normalizedJobDraft.pricing?.bundleServiceIds || []
    );
    const requestedServiceId =
      payload.jobData?.serviceId ||
      payload.serviceId ||
      normalizedJobDraft.serviceId ||
      normalizedJobDraft.serviceType ||
      "";
    const pricingInput = firstNonEmptyObject(
      payload.jobData?.pricingInput,
      payload.pricingInput,
      normalizedJobDraft.pricing?.input
    );

    if (Array.isArray(bundleServiceIds) && bundleServiceIds.length > 0) {
      const quote = await calculateBundleQuote(bundleServiceIds, pricingInput);

      return {
        quote,
        service: {
          id: quote.serviceId,
          title: quote.serviceTitle,
          categoryId: "bundle",
          categoryLabel: "Service Bundle",
        },
      };
    }

    const quote = await calculateQuote(requestedServiceId, pricingInput);
    const service = await findServiceDefinition(requestedServiceId);

    if (!service) {
      throw new AppError("Selected service is not available for checkout", 400);
    }

    return {
      quote,
      service,
    };
  }

  calculateAmounts(jobSubtotal) {
    const numericJobSubtotal = Number(jobSubtotal || 0);
    const bookingFee = Math.max(0, Number(env.customerBookingFeeAmount || 0));
    const platformFeePercentage = env.defaultPlatformFeePercentage;
    const platformFee = Number(
      ((numericJobSubtotal * platformFeePercentage) / 100).toFixed(2)
    );
    const workerPayout = Number((numericJobSubtotal - platformFee).toFixed(2));
    const amount = Number((numericJobSubtotal + bookingFee).toFixed(2));

    return {
      amount,
      jobSubtotal: numericJobSubtotal,
      bookingFee,
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

  buildTransferGroup(paymentId) {
    return `payment_${paymentId}`;
  }

  getLatestChargeId(paymentIntent) {
    if (!paymentIntent?.latest_charge) {
      return "";
    }

    return typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : String(paymentIntent.latest_charge.id || "");
  }

  getRefundedAmount(payment) {
    const refundedAmount = Number(payment?.stripeRefundAmount || 0);
    return Number.isFinite(refundedAmount) ? refundedAmount : 0;
  }

  getRemainingRefundableAmount(payment) {
    const totalAmount = Number(payment?.amount || 0);
    return Math.max(0, Number((totalAmount - this.getRefundedAmount(payment)).toFixed(2)));
  }

  isFullyRefunded(payment, refundedAmount = this.getRefundedAmount(payment)) {
    const totalAmount = Number(payment?.amount || 0);
    return totalAmount > 0 && refundedAmount >= totalAmount - 0.000001;
  }

  getStripeRefundTimestamp(refund) {
    if (!refund?.created) {
      return null;
    }

    const refundDate = new Date(Number(refund.created) * 1000);
    return Number.isNaN(refundDate.getTime()) ? null : refundDate;
  }

  getStripeDisputeEvidenceDueDate(dispute) {
    if (!dispute?.evidence_details?.due_by) {
      return null;
    }

    const dueDate = new Date(Number(dispute.evidence_details.due_by) * 1000);
    return Number.isNaN(dueDate.getTime()) ? null : dueDate;
  }

  normalizeRefundReason(reason = "") {
    const normalizedReason = String(reason || "").trim().toLowerCase();
    const allowedReasons = ["duplicate", "fraudulent", "requested_by_customer"];

    return allowedReasons.includes(normalizedReason) ? normalizedReason : "requested_by_customer";
  }

  getChargeIdFromRefund(refund) {
    return String(refund?.charge || "").trim();
  }

  getChargeIdFromDispute(dispute) {
    return String(dispute?.charge || "").trim();
  }

  isDisputeActionable(disputeStatus = "") {
    return ["warning_needs_response", "warning_under_review", "needs_response"].includes(
      String(disputeStatus || "").trim().toLowerCase()
    );
  }

  buildDisputeEvidencePayload(payment, payload = {}) {
    const booking = payment?.booking || {};
    const job = payment?.job || {};
    const customer = payment?.customer || {};
    const defaultServiceDate =
      booking?.completedAt ||
      booking?.scheduledDate ||
      job?.preferredDate ||
      payment?.paidAt ||
      null;

    const normalizedEvidence = {
      customer_name: String(payload.customerName || customer?.name || "").trim(),
      customer_email_address: String(payload.customerEmail || customer?.email || "").trim(),
      product_description: String(
        payload.productDescription || job?.title || job?.serviceType || payment?.description || ""
      ).trim(),
      service_date: defaultServiceDate
        ? new Date(defaultServiceDate).toISOString().slice(0, 10)
        : "",
      uncategorized_text: String(payload.summary || payload.uncategorizedText || "").trim(),
    };

    return Object.fromEntries(
      Object.entries(normalizedEvidence).filter(([, value]) => Boolean(String(value || "").trim()))
    );
  }

  buildCheckoutFingerprint(userId, normalizedJobDraft, pricing, currency = "USD") {
    const fingerprintPayload = {
      customerId: String(userId || ""),
      serviceId: String(normalizedJobDraft?.serviceId || ""),
      title: String(normalizedJobDraft?.title || ""),
      streetAddress: String(normalizedJobDraft?.streetAddress || ""),
      city: String(normalizedJobDraft?.city || ""),
      state: String(normalizedJobDraft?.state || ""),
      zipCode: String(normalizedJobDraft?.zipCode || ""),
      jobDescription: String(normalizedJobDraft?.jobDescription || ""),
      preferredDate: normalizedJobDraft?.preferredDate
        ? new Date(normalizedJobDraft.preferredDate).toISOString()
        : "",
      preferredTime: String(normalizedJobDraft?.preferredTime || ""),
      amount: Number(pricing?.amount || 0),
      currency: String(currency || "USD").toUpperCase(),
      pricingQuote: normalizedJobDraft?.pricing || null,
    };

    return crypto
      .createHash("sha256")
      .update(JSON.stringify(fingerprintPayload))
      .digest("hex");
  }

  isRecentPendingCheckout(payment) {
    if (!payment?.createdAt) {
      return false;
    }

    return (
      Date.now() - new Date(payment.createdAt).getTime() <= REUSABLE_PENDING_CHECKOUT_WINDOW_MS
    );
  }

  async findReusableCheckoutAttempt(userId, checkoutFingerprint) {
    if (!userId || !checkoutFingerprint) {
      return null;
    }

    return paymentRepository.findOne(
      {
        customer: userId,
        status: { $in: ["pending", "failed"] },
        job: null,
        booking: null,
        "metadata.checkoutFingerprint": checkoutFingerprint,
      },
      {
        sort: { createdAt: -1 },
      }
    );
  }

  async findPaymentForCheckoutSession(session) {
    if (!session?.id) {
      return null;
    }

    const existingBySessionId = await paymentRepository.findBySessionId(session.id);

    if (existingBySessionId) {
      return existingBySessionId;
    }

    const paymentRecordId = session?.metadata?.paymentRecordId;

    if (!paymentRecordId) {
      return null;
    }

    const payment = await paymentRepository.findById(paymentRecordId);

    if (!payment) {
      return null;
    }

    const backfillUpdate = {};

    if (!payment.stripeCheckoutSessionId) {
      backfillUpdate.stripeCheckoutSessionId = session.id;
    }

    if (!payment.checkoutUrl && session.url) {
      backfillUpdate.checkoutUrl = session.url;
    }

    if (Object.keys(backfillUpdate).length) {
      return paymentRepository.updateById(payment._id, backfillUpdate);
    }

    return payment;
  }

  async findPaymentForPaymentIntent(paymentIntent) {
    if (!paymentIntent?.id) {
      return null;
    }

    let payment = await paymentRepository.findOne({
      stripePaymentIntentId: paymentIntent.id,
    });

    if (!payment && paymentIntent?.metadata?.paymentRecordId) {
      payment = await paymentRepository.findById(paymentIntent.metadata.paymentRecordId);
    }

    if (!payment) {
      return null;
    }

    const backfillUpdate = {};

    if (!payment.stripePaymentIntentId) {
      backfillUpdate.stripePaymentIntentId = paymentIntent.id;
    }

    if (!payment.stripeCustomerId && paymentIntent.customer) {
      backfillUpdate.stripeCustomerId = paymentIntent.customer;
    }

    if (!payment.stripePaymentMethodId && paymentIntent.payment_method) {
      backfillUpdate.stripePaymentMethodId = paymentIntent.payment_method;
    }

    if (!payment.stripeTransferGroup && paymentIntent.transfer_group) {
      backfillUpdate.stripeTransferGroup = paymentIntent.transfer_group;
    }

    const latestChargeId = this.getLatestChargeId(paymentIntent);

    if (!payment.stripeChargeId && latestChargeId) {
      backfillUpdate.stripeChargeId = latestChargeId;
    }

    if (Object.keys(backfillUpdate).length) {
      return paymentRepository.updateById(payment._id, backfillUpdate);
    }

    return payment;
  }

  async findPaymentForChargeId(chargeId) {
    const normalizedChargeId = String(chargeId || "").trim();

    if (!normalizedChargeId) {
      return null;
    }

    let payment = await paymentRepository.findByChargeId(normalizedChargeId);

    if (payment) {
      return payment;
    }

    const stripe = this.getStripeClient();
    const charge = await stripe.charges.retrieve(normalizedChargeId);

    if (!charge?.payment_intent) {
      return null;
    }

    payment = await this.findPaymentForPaymentIntent({
      id: charge.payment_intent,
      customer: charge.customer || "",
      payment_method: charge.payment_method || "",
      transfer_group: charge.transfer_group || "",
      latest_charge: charge.id,
      metadata: charge.metadata || {},
    });

    return payment;
  }

  async ensureWorkerTransferForPaidPayment(payment, paymentIntent = null, context = {}) {
    if (!payment?._id) {
      return {
        status: "payment_not_found",
      };
    }

    const latestPayment = await paymentRepository.findById(payment._id);

    if (!latestPayment) {
      return {
        status: "payment_not_found",
      };
    }

    if (latestPayment.stripeTransferId) {
      return {
        status: "already_transferred",
        transferId: latestPayment.stripeTransferId,
      };
    }

    if (latestPayment.status !== "paid") {
      return {
        status: "payment_not_paid",
      };
    }

    if (!latestPayment.worker) {
      await paymentRepository.updateById(latestPayment._id, {
        workerTransferStatus: "not_ready",
        workerLastPayoutFailure: "No worker is assigned to this payment yet",
      });

      return {
        status: "worker_not_assigned",
      };
    }

    const worker = await userRepository.findById(latestPayment.worker);

    if (!worker || !worker.stripeConnectedAccountId || !isWorkerPayoutReady(worker)) {
      await paymentRepository.updateById(latestPayment._id, {
        workerTransferStatus: "not_ready",
        workerLastPayoutFailure:
          "The assigned worker must finish Stripe payout onboarding before payout release",
      });

      return {
        status: "worker_not_ready",
      };
    }

    let resolvedPaymentIntent = paymentIntent;

    if (!resolvedPaymentIntent && latestPayment.stripePaymentIntentId) {
      resolvedPaymentIntent = await this.retrievePaymentIntent(latestPayment.stripePaymentIntentId);
    }

    const sourceChargeId = this.getLatestChargeId(resolvedPaymentIntent);

    if (!sourceChargeId) {
      await paymentRepository.updateById(latestPayment._id, {
        workerTransferStatus: "failed",
        workerTransferFailedAt: new Date(),
        workerLastPayoutFailure:
          "Stripe charge details were not available for worker transfer creation",
      });

      return {
        status: "charge_not_ready",
      };
    }

    const transferGroup = latestPayment.stripeTransferGroup || this.buildTransferGroup(latestPayment._id);

    try {
      const transfer = await this.getStripeClient().transfers.create(
        {
          amount: Math.round(Number(latestPayment.workerPayout || 0) * 100),
          currency: String(latestPayment.currency || "usd").toLowerCase(),
          destination: worker.stripeConnectedAccountId,
          source_transaction: sourceChargeId,
          transfer_group: transferGroup,
          metadata: {
            paymentRecordId: String(latestPayment._id),
            bookingId: String(latestPayment.booking || ""),
            jobId: String(latestPayment.job || ""),
            workerId: String(worker._id),
            approvedByUserId: String(context.approvedByUserId || ""),
          },
        },
        {
          idempotencyKey: `worker_transfer_${latestPayment._id}`,
        }
      );

      await paymentRepository.updateById(latestPayment._id, {
        stripeTransferId: transfer.id,
        stripeTransferAmount: Number((Number(transfer.amount || 0) / 100).toFixed(2)),
        stripeTransferDestinationAccountId: worker.stripeConnectedAccountId,
        stripeTransferGroup: transfer.transfer_group || transferGroup,
        workerTransferStatus: "transferred",
        workerTransferredAt: new Date(),
        workerTransferFailedAt: null,
        workerLastPayoutFailure: "",
      });

      return {
        status: "transferred",
        transferId: transfer.id,
      };
    } catch (error) {
      const errorMessage = this.normalizeRepairErrorMessage(error);

      await paymentRepository.updateById(latestPayment._id, {
        stripeTransferGroup: transferGroup,
        workerTransferStatus: "failed",
        workerTransferFailedAt: new Date(),
        workerLastPayoutFailure: errorMessage,
      });

      logger.error(
        {
          err: error,
          paymentId: latestPayment._id,
          workerId: worker._id,
          connectedAccountId: worker.stripeConnectedAccountId,
        },
        "Stripe worker transfer creation failed"
      );

      return {
        status: "failed",
        errorMessage,
      };
    }
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

    const persistedPhotoUrls = await jobService.persistJobPhotos(draftJob.photos, {
      strict: false,
    });
    const hasPersistedNewPhotos =
      JSON.stringify(persistedPhotoUrls) !== JSON.stringify(draftJob.photos || []);
    const jobDraft = {
      ...draftJob,
      photos: persistedPhotoUrls,
    };

    if (hasPersistedNewPhotos) {
      await paymentRepository.updateById(payment._id, {
        "metadata.draftJob.photos": persistedPhotoUrls,
      });
    }

    try {
      return await jobRepository.create({
        ...jobDraft,
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

  async getApprovedWorkerEmailRecipients() {
    return userRepository.findMany(
      combineMongoFilters(
        {
          isDeleted: { $ne: true },
          status: "active",
          workerStatus: "approved",
          email: { $exists: true, $ne: "" },
        },
        buildRoleMembershipFilter(ROLES.WORKER)
      ),
      {
        lean: true,
        select: "_id name email role roles workerStatus status",
      }
    );
  }

  async sendNewJobAvailableEmailToWorkers(job, payment) {
    if (!job?._id) {
      return {
        sent: 0,
        failed: 0,
      };
    }

    const workers = await this.getApprovedWorkerEmailRecipients();

    if (!workers.length) {
      return {
        sent: 0,
        failed: 0,
      };
    }

    const jobLink = `/all-jobs/job-details?jobId=${job._id}`;
    const results = await Promise.allSettled(
      workers.map((worker) =>
        emailService.sendNewJobAvailableEmail({
          to: worker.email,
          job,
          payment,
          jobLink,
        })
      )
    );
    const failed = results.filter((result) => result.status === "rejected");

    if (failed.length) {
      logger.warn(
        {
          jobId: String(job._id),
          failedCount: failed.length,
          recipientCount: workers.length,
        },
        "Some new job available emails failed to send"
      );
    }

    return {
      sent: results.length - failed.length,
      failed: failed.length,
    };
  }

  async createTransferReversalForAdjustment(
    payment,
    amount,
    { reason = "", metadata = {}, idempotencyKeySuffix = "" } = {}
  ) {
    if (!payment?.stripeTransferId || !amount || amount <= 0) {
      return {
        status: "not_required",
        reversalAmount: 0,
      };
    }

    const latestPayment = await paymentRepository.findById(payment._id);

    if (!latestPayment?.stripeTransferId) {
      return {
        status: "not_required",
        reversalAmount: 0,
      };
    }

    const transferableAmount = Number(latestPayment.workerPayout || 0);
    const alreadyReversedAmount = Number(latestPayment.stripeTransferReversedAmount || 0);
    const proportionalAmount =
      Number(latestPayment.amount || 0) > 0
        ? Number(
            ((Number(amount || 0) / Number(latestPayment.amount || 1)) * transferableAmount).toFixed(2)
          )
        : 0;
    const remainingReversibleAmount = Math.max(
      0,
      Number((transferableAmount - alreadyReversedAmount).toFixed(2))
    );
    const reversalAmount = Math.min(remainingReversibleAmount, proportionalAmount || remainingReversibleAmount);

    if (reversalAmount <= 0) {
      return {
        status: "already_reversed",
        reversalAmount: 0,
      };
    }

    const reversal = await this.getStripeClient().transfers.createReversal(
      latestPayment.stripeTransferId,
      {
        amount: Math.round(reversalAmount * 100),
        description: reason || "Payment adjustment",
        metadata: {
          paymentRecordId: String(latestPayment._id),
          jobId: String(latestPayment.job || ""),
          bookingId: String(latestPayment.booking || ""),
          ...metadata,
        },
      },
      {
        idempotencyKey:
          `transfer_reversal_${latestPayment._id}_${Math.round(reversalAmount * 100)}` +
          `${idempotencyKeySuffix ? `_${idempotencyKeySuffix}` : ""}`,
      }
    );

    const updatedReversedAmount = Number(
      (alreadyReversedAmount + Number(reversal.amount || 0) / 100).toFixed(2)
    );

    await paymentRepository.updateById(latestPayment._id, {
      stripeLatestTransferReversalId: reversal.id,
      stripeTransferReversedAmount: updatedReversedAmount,
      stripeTransferReversedAt: new Date(),
    });

    return {
      status: "reversed",
      reversalId: reversal.id,
      reversalAmount: Number((Number(reversal.amount || 0) / 100).toFixed(2)),
    };
  }

  async syncRefundState(payment, refund, context = {}) {
    if (!payment?._id || !refund?.id) {
      return payment;
    }

    const latestPayment = await paymentRepository.findById(payment._id);

    if (!latestPayment) {
      return null;
    }

    let refundedAmount = this.getRefundedAmount(latestPayment);

    if (this.getChargeIdFromRefund(refund)) {
      try {
        const charge = await this.getStripeClient().charges.retrieve(this.getChargeIdFromRefund(refund));
        refundedAmount = Number((Number(charge.amount_refunded || 0) / 100).toFixed(2));
      } catch (error) {
        refundedAmount = Number(
          (
            refundedAmount +
            (latestPayment.stripeLatestRefundId === refund.id ? 0 : Number(refund.amount || 0) / 100)
          ).toFixed(2)
        );
      }
    } else {
      refundedAmount = Number(
        (
          refundedAmount +
          (latestPayment.stripeLatestRefundId === refund.id ? 0 : Number(refund.amount || 0) / 100)
        ).toFixed(2)
      );
    }

    const refundTimestamp = this.getStripeRefundTimestamp(refund) || new Date();
    const isSucceededRefund = refund.status === "succeeded";
    const isFullyRefunded = isSucceededRefund && this.isFullyRefunded(latestPayment, refundedAmount);
    const nextStatus = isFullyRefunded ? "refunded" : latestPayment.status;
    const update = this.buildStripeSyncUpdate(
      context,
      {
        status: nextStatus,
        stripeLatestRefundId: refund.id,
        stripeRefundStatus: String(refund.status || "").trim(),
        stripeRefundAmount: refundedAmount,
        refundedAt: isSucceededRefund ? refundTimestamp : latestPayment.refundedAt,
        refundReason:
          String(refund.reason || latestPayment.refundReason || "").trim() ||
          latestPayment.refundReason ||
          "",
        refundFailureReason: "",
      },
      refundTimestamp
    );

    const updatedPayment = await paymentRepository.updateById(latestPayment._id, update);

    if (updatedPayment?.job) {
      await this.syncJobPaymentState(updatedPayment.job, {
        paymentStatus: isFullyRefunded ? "refunded" : updatedPayment.status,
        isPaid: !isFullyRefunded,
      });
    }

    return updatedPayment;
  }

  async syncFailedRefundState(payment, refund, context = {}) {
    if (!payment?._id || !refund?.id) {
      return payment;
    }

    return paymentRepository.updateById(
      payment._id,
      this.buildStripeSyncUpdate(
        context,
        {
          stripeLatestRefundId: refund.id,
          stripeRefundStatus: String(refund.status || "failed").trim(),
          refundFailureReason: this.normalizeRepairErrorMessage(
            refund.failure_reason || "Stripe refund failed"
          ),
        },
        new Date()
      )
    );
  }

  async syncDisputeState(payment, dispute, context = {}) {
    if (!payment?._id || !dispute?.id) {
      return payment;
    }

    const disputeAmount = Number((Number(dispute.amount || 0) / 100).toFixed(2));
    const update = this.buildStripeSyncUpdate(
      context,
      {
        stripeDisputeId: dispute.id,
        stripeDisputeStatus: String(dispute.status || "").trim(),
        stripeDisputeReason: String(dispute.reason || "").trim(),
        stripeDisputeAmount: disputeAmount,
        stripeDisputeEvidenceDueBy: this.getStripeDisputeEvidenceDueDate(dispute),
        stripeDisputeOutcome:
          ["won", "lost", "warning_closed"].includes(String(dispute.status || ""))
            ? String(dispute.status || "")
            : "",
        stripeDisputeClosedAt:
          ["won", "lost", "warning_closed"].includes(String(dispute.status || ""))
            ? new Date()
            : null,
      },
      new Date()
    );

    return paymentRepository.updateById(payment._id, update);
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
            stripeChargeId:
              this.getLatestChargeId(paymentIntent) || latestPayment.stripeChargeId || "",
            stripeTransferGroup:
              paymentIntent?.transfer_group ||
              latestPayment.stripeTransferGroup ||
              this.buildTransferGroup(latestPayment._id),
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
      const shouldNotify = latestPayment.status !== "authorized" || !latestPayment.job;
      const shouldNotifyWorkers = !latestPayment.job;

      if (shouldNotify) {
        const jobTitle =
          ensuredJob?.title || latestPayment?.metadata?.draftJob?.title || "your booking request";

        await Promise.allSettled([
          notificationService.createForUser(latestPayment.customer, {
            type: "job_request_submitted",
            recipientRole: ROLES.CUSTOMER,
            category: "job",
            title: "Booking request submitted",
            message: `"${jobTitle}" was submitted and is waiting for a Hero.`,
            link: `/booking-details?jobId=${jobId}`,
            entityType: "job",
            entityId: String(jobId),
          }),
          notificationService.notifyAdmins({
            type: "job_request_submitted",
            category: "job",
            title: "New booking request",
            message: `${latestPayment?.metadata?.draftJob?.fullName || "A customer"} submitted "${jobTitle}".`,
            link: `/booking/${jobId}`,
            entityType: "job",
            entityId: String(jobId),
            actorUserId: latestPayment.customer,
          }),
          shouldNotifyWorkers
            ? this.sendNewJobAvailableEmailToWorkers(ensuredJob, updatedPayment)
            : Promise.resolve(),
        ]);
      }

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
            stripeChargeId:
              this.getLatestChargeId(paymentIntent) || latestPayment.stripeChargeId || "",
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
      const workerTransfer = await this.ensureWorkerTransferForPaidPayment(
        updatedPayment,
        paymentIntent,
        context
      );
      const shouldNotify = latestPayment.status !== "paid" || !latestPayment.job;
      const shouldNotifyWorkers = !latestPayment.job;

      if (shouldNotify) {
        const jobTitle =
          ensuredJob?.title || latestPayment?.metadata?.draftJob?.title || "your booking request";

        await Promise.allSettled([
          notificationService.createForUser(latestPayment.customer, {
            type: "job_request_submitted",
            recipientRole: ROLES.CUSTOMER,
            category: "job",
            title: "Booking request submitted",
            message: `"${jobTitle}" was submitted successfully.`,
            link: `/booking-details?jobId=${jobId}`,
            entityType: "job",
            entityId: String(jobId),
          }),
          notificationService.notifyAdmins({
            type: "job_request_submitted",
            category: "job",
            title: "New booking request",
            message: `${latestPayment?.metadata?.draftJob?.fullName || "A customer"} submitted "${jobTitle}".`,
            link: `/booking/${jobId}`,
            entityType: "job",
            entityId: String(jobId),
            actorUserId: latestPayment.customer,
          }),
          shouldNotifyWorkers
            ? this.sendNewJobAvailableEmailToWorkers(ensuredJob, updatedPayment)
            : Promise.resolve(),
        ]);
      }

      return {
        status:
          latestPayment.status === "paid" && latestPayment.job ? "already_paid" : "paid",
        paymentId: String(updatedPayment._id),
        jobId: String(jobId),
        sessionId: session?.id || "",
        workerTransferStatus: workerTransfer.status,
        workerTransferId: workerTransfer.transferId || "",
      };
    } finally {
      await paymentRepository.releaseReconciliationLock(payment._id);
    }
  }

  async reconcileCheckoutSession(session, context = {}) {
    if (!session?.id) {
      throw new AppError("Stripe checkout session id is required for reconciliation", 500);
    }

    const payment = await this.findPaymentForCheckoutSession(session);

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

    if (session.payment_status === "paid") {
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
    if (!hasAnyRole(user, ROLES.CUSTOMER, ROLES.ADMIN)) {
      throw new AppError("Only customers and admins can create checkout sessions", 403);
    }

    const normalizedJobDraft = jobService.mapCreatePayload(user, payload.jobData || payload);
    jobService.validateCreatePayload(normalizedJobDraft);

    const { quote, service } = await this.resolveCheckoutQuote(payload, normalizedJobDraft);
    const jobSubtotal = quote.finalPrice;
    const pricing = this.calculateAmounts(jobSubtotal);

    if (!pricing.jobSubtotal) {
      throw new AppError("A valid amount is required to create a payment session", 400);
    }

    normalizedJobDraft.serviceId = service.id;
    normalizedJobDraft.serviceType = normalizedJobDraft.serviceType || service.title;
    normalizedJobDraft.title = normalizedJobDraft.title || service.title;
    normalizedJobDraft.serviceCategoryId =
      normalizedJobDraft.serviceCategoryId || service.categoryId || "";
    normalizedJobDraft.serviceCategoryLabel =
      normalizedJobDraft.serviceCategoryLabel || service.categoryLabel || "";
    normalizedJobDraft.estimatedPrice = pricing.jobSubtotal;
    normalizedJobDraft.priceQuoted = pricing.jobSubtotal;
    normalizedJobDraft.pricing = quote;
    const currency = payload.currency || "USD";
    const checkoutFingerprint = this.buildCheckoutFingerprint(
      user._id,
      normalizedJobDraft,
      pricing,
      currency
    );
    const reusablePayment = await this.findReusableCheckoutAttempt(
      user._id,
      checkoutFingerprint
    );

    if (
      reusablePayment &&
      this.isRecentPendingCheckout(reusablePayment) &&
      reusablePayment.status === "pending" &&
      reusablePayment.stripeCheckoutSessionId &&
      reusablePayment.checkoutUrl
    ) {
      return {
        payment: reusablePayment,
        url: reusablePayment.checkoutUrl,
        sessionId: reusablePayment.stripeCheckoutSessionId,
      };
    }

    normalizedJobDraft.photos = await jobService.persistJobPhotos(normalizedJobDraft.photos);

    const paymentRecord =
      reusablePayment && this.isRecentPendingCheckout(reusablePayment)
        ? await paymentRepository.updateById(reusablePayment._id, {
            amount: pricing.amount,
            jobSubtotal: pricing.jobSubtotal,
            bookingFee: pricing.bookingFee,
            currency,
            platformFeePercentage: pricing.platformFeePercentage,
            platformFee: pricing.platformFee,
            workerPayout: pricing.workerPayout,
            status: "pending",
            gateway: "stripe",
            paymentMethod: "card",
            description: payload.description || `${normalizedJobDraft.title} booking payment`,
            stripeTransferGroup:
              reusablePayment.stripeTransferGroup ||
              this.buildTransferGroup(reusablePayment._id),
            stripeCheckoutSessionId: reusablePayment.stripeCheckoutSessionId || "",
            checkoutUrl: reusablePayment.checkoutUrl || "",
            lastRepairError: "",
            lastCaptureError: "",
            workerTransferStatus: "pending",
            workerTransferFailedAt: null,
            workerTransferredAt: null,
            workerLastPayoutFailure: "",
            metadata: {
              draftJob: normalizedJobDraft,
              pricingQuote: quote,
              checkoutFingerprint,
            },
          })
        : await paymentRepository.create({
            customer: user._id,
            amount: pricing.amount,
            jobSubtotal: pricing.jobSubtotal,
            bookingFee: pricing.bookingFee,
            currency,
            platformFeePercentage: pricing.platformFeePercentage,
            platformFee: pricing.platformFee,
            workerPayout: pricing.workerPayout,
            status: "pending",
            gateway: "stripe",
            paymentMethod: "card",
            description: payload.description || `${normalizedJobDraft.title} booking payment`,
            metadata: {
              draftJob: normalizedJobDraft,
              pricingQuote: quote,
              checkoutFingerprint,
            },
          });
    const transferGroup =
      paymentRecord.stripeTransferGroup || this.buildTransferGroup(paymentRecord._id);

    try {
      const stripe = this.getStripeClient();
      const cancelUrl = this.resolveClientReturnUrl(payload.cancelUrl, "/book");

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer_creation: "always",
          customer_email: normalizedJobDraft.email,
          payment_method_types: ["card"],
          payment_intent_data: {
            setup_future_usage: "off_session",
            transfer_group: transferGroup,
            metadata: {
              paymentRecordId: String(paymentRecord._id),
            },
          },
          line_items: [
            {
              price_data: {
                currency: String(currency || "usd").toLowerCase(),
                product_data: {
                  name: normalizedJobDraft.title,
                  description: normalizedJobDraft.jobDescription,
                },
                unit_amount: Math.round(pricing.jobSubtotal * 100),
              },
              quantity: 1,
            },
            ...(pricing.bookingFee > 0 ? [{
              price_data: {
                currency: String(currency || "usd").toLowerCase(),
                product_data: {
                  name: "Service Fee",
                  description: "YardHero booking fee",
                },
                unit_amount: Math.round(pricing.bookingFee * 100),
              },
              quantity: 1,
            }] : []),
          ],
          success_url: this.buildCheckoutSuccessUrl(),
          cancel_url: cancelUrl,
          metadata: {
            paymentRecordId: String(paymentRecord._id),
            paymentFlow: "authorize_then_capture",
            transferGroup,
          },
        },
        {
          idempotencyKey: `checkout_${checkoutFingerprint}`,
        }
      );

      const updatedPayment = await paymentRepository.updateById(paymentRecord._id, {
        stripeCheckoutSessionId: session.id,
        checkoutUrl: session.url,
        stripeTransferGroup: transferGroup,
      });

      return {
        payment: updatedPayment,
        url: session.url,
        sessionId: session.id,
      };
    } catch (error) {
      await paymentRepository.updateById(paymentRecord._id, {
        status: "failed",
        lastRepairError: this.normalizeRepairErrorMessage(error),
      });

      throw error;
    }
  }

  assertPaymentAccess(user, payment) {
    const isAllowed =
      hasRole(user, ROLES.ADMIN) ||
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

    const isAdmin = hasRole(user, ROLES.ADMIN);

    if (isAdmin) {
      const [result] = await paymentRepository.listForDashboard(filter, {
        page: pagination.page,
        limit: pagination.limit,
        search: query.search,
        exactDate: String(query.date || "").trim(),
        dateRangeStart: this.getDateRangeStart(query.dateRange),
        includeSummary: true,
      });

      const items = Array.isArray(result?.items) ? result.items : [];
      const total = Number(result?.totalCount?.[0]?.count || 0);
      const summary = result?.summary?.[0] || {
        totalAmount: 0,
        totalPlatformFee: 0,
        totalHeroPayout: 0,
        pendingPayments: 0,
        pendingCount: 0,
        paidCount: 0,
        totalCount: 0,
      };

      return {
        items,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages: Math.ceil(total / pagination.limit) || 1,
        },
        summary,
      };
    }

    const items = await paymentRepository.findMany(filter, {
      populate: paymentRepository.buildRelationsPopulate(),
      sort: { createdAt: -1 },
      lean: true,
    });

    const normalizedSearch = String(query.search || "").trim().toLowerCase();
    const exactDate = String(query.date || "").trim();
    const dateRange = query.dateRange;
    const filteredItems = items.filter((payment) => {
      const paymentId = String(payment?._id || "").toLowerCase();
      const searchMatches =
        !normalizedSearch ||
        [
          paymentId,
          payment?.job?.title,
          payment?.job?.serviceType,
          payment?.customer?.name,
          payment?.customer?.email,
          payment?.worker?.name,
          payment?.worker?.email,
          payment?.description,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch));

      return (
        searchMatches &&
        this.matchesSpecificDate(payment, exactDate) &&
        this.matchesDateRange(payment, dateRange)
      );
    });

    return {
      items: filteredItems.slice(
        (pagination.page - 1) * pagination.limit,
        pagination.page * pagination.limit
      ),
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

  async refundPayment(user, paymentId, payload = {}) {
    if (!hasRole(user, ROLES.ADMIN)) {
      throw new AppError("Only admins can issue refunds", 403);
    }

    const payment = await paymentRepository.findById(paymentId, {
      populate: paymentRepository.buildRelationsPopulate(),
    });

    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    if (payment.gateway !== "stripe") {
      throw new AppError("Only Stripe payments can be refunded through this workflow", 409);
    }

    if (!["paid", "refunded"].includes(payment.status)) {
      throw new AppError("Only paid payments can be refunded", 409);
    }

    const remainingRefundableAmount = this.getRemainingRefundableAmount(payment);

    if (remainingRefundableAmount <= 0) {
      throw new AppError("This payment has already been fully refunded", 409);
    }

    const requestedAmount =
      payload.amount === undefined || payload.amount === null || payload.amount === ""
        ? remainingRefundableAmount
        : Number(payload.amount);

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new AppError("Refund amount must be greater than zero", 400);
    }

    if (requestedAmount > remainingRefundableAmount) {
      throw new AppError("Refund amount exceeds the remaining refundable balance", 400);
    }

    let chargeId = String(payment.stripeChargeId || "").trim();

    if (!chargeId && payment.stripePaymentIntentId) {
      const paymentIntent = await this.retrievePaymentIntent(payment.stripePaymentIntentId);
      chargeId = this.getLatestChargeId(paymentIntent);

      if (chargeId && !payment.stripeChargeId) {
        await paymentRepository.updateById(payment._id, {
          stripeChargeId: chargeId,
        });
      }
    }

    if (!chargeId) {
      throw new AppError("Stripe charge details are unavailable for this payment", 409);
    }

    const stripe = this.getStripeClient();
    const reason = this.normalizeRefundReason(payload.reason);
    const refund = await stripe.refunds.create(
      {
        charge: chargeId,
        amount: Math.round(requestedAmount * 100),
        reason,
        metadata: {
          paymentRecordId: String(payment._id),
          jobId: String(payment.job?._id || payment.job || ""),
          bookingId: String(payment.booking?._id || payment.booking || ""),
          adminUserId: String(user._id || ""),
        },
      },
      {
        idempotencyKey: `refund_${payment._id}_${Math.round(requestedAmount * 100)}`,
      }
    );

    let updatedPayment =
      refund.status === "failed"
        ? await this.syncFailedRefundState(payment, refund, {
            source: "admin_refund",
          })
        : await this.syncRefundState(payment, refund, {
            source: "admin_refund",
          });

    let transferReversal = {
      status: "not_required",
      reversalAmount: 0,
      reversalId: "",
    };

    if (refund.status !== "failed") {
      try {
        transferReversal = await this.createTransferReversalForAdjustment(
          updatedPayment || payment,
          requestedAmount,
          {
            reason: `Refund ${refund.id}`,
            metadata: {
              refundId: refund.id,
              adminUserId: String(user._id || ""),
            },
            idempotencyKeySuffix: refund.id,
          }
        );
      } catch (error) {
        logger.error(
          {
            err: error,
            paymentId: payment._id,
            refundId: refund.id,
          },
          "Stripe transfer reversal failed after refund creation"
        );
      }
    }

    updatedPayment = await paymentRepository.findById(payment._id, {
      populate: paymentRepository.buildRelationsPopulate(),
    });

    await Promise.allSettled([
      notificationService.createForUser(payment.customer, {
        type: "payment_refunded",
        recipientRole: ROLES.CUSTOMER,
        category: "payment",
        title: "Payment refund issued",
        message:
          requestedAmount >= Number(payment.amount || 0)
            ? `A full refund of $${requestedAmount.toFixed(2)} was issued for your booking.`
            : `A refund of $${requestedAmount.toFixed(2)} was issued for your booking.`,
        link: `/payment-history`,
        entityType: "payment",
        entityId: String(payment._id),
        actorUserId: user._id,
      }),
      payment.worker
        ? notificationService.createForUser(payment.worker, {
            type: "payment_adjusted",
            recipientRole: ROLES.WORKER,
            category: "payment",
            title: "Payment adjusted",
            message: `A refund of $${requestedAmount.toFixed(2)} was issued for a completed job.`,
            link: `/payment`,
            entityType: "payment",
            entityId: String(payment._id),
            actorUserId: user._id,
          })
        : null,
      notificationService.notifyAdmins(
        {
          type: "payment_refunded",
          category: "payment",
          title: "Payment refunded",
          message: `Refund ${refund.id} was created for payment ${payment._id}.`,
          link: `/payment-details`,
          entityType: "payment",
          entityId: String(payment._id),
          actorUserId: user._id,
        },
        { preferenceKey: "paymentIssues" }
      ),
    ]);

    return {
      payment: updatedPayment,
      refund: {
        id: refund.id,
        amount: Number((Number(refund.amount || 0) / 100).toFixed(2)),
        status: refund.status,
        reason: refund.reason || reason,
      },
      transferReversal,
    };
  }

  async acceptDispute(user, paymentId) {
    if (!hasRole(user, ROLES.ADMIN)) {
      throw new AppError("Only admins can accept disputes", 403);
    }

    const payment = await paymentRepository.findById(paymentId, {
      populate: paymentRepository.buildRelationsPopulate(),
    });

    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    const disputeId = String(payment.stripeDisputeId || "").trim();

    if (!disputeId) {
      throw new AppError("No active Stripe dispute was found for this payment", 409);
    }

    if (!this.isDisputeActionable(payment.stripeDisputeStatus)) {
      throw new AppError("This dispute can no longer be accepted", 409);
    }

    const dispute = await this.getStripeClient().disputes.close(disputeId);

    await this.syncDisputeState(payment, dispute, {
      source: "admin_dispute_accept",
    });

    await paymentRepository.updateById(payment._id, {
      stripeDisputeSubmittedAt: new Date(),
      stripeDisputeLastAction: "accepted",
      stripeDisputeLastActionBy: user._id,
    });

    return {
      payment: await paymentRepository.findById(payment._id, {
        populate: paymentRepository.buildRelationsPopulate(),
      }),
      dispute,
    };
  }

  async submitDisputeEvidence(user, paymentId, payload = {}) {
    if (!hasRole(user, ROLES.ADMIN)) {
      throw new AppError("Only admins can respond to disputes", 403);
    }

    const payment = await paymentRepository.findById(paymentId, {
      populate: paymentRepository.buildRelationsPopulate(),
    });

    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    const disputeId = String(payment.stripeDisputeId || "").trim();

    if (!disputeId) {
      throw new AppError("No active Stripe dispute was found for this payment", 409);
    }

    if (!this.isDisputeActionable(payment.stripeDisputeStatus)) {
      throw new AppError("This dispute can no longer accept evidence", 409);
    }

    const evidence = this.buildDisputeEvidencePayload(payment, payload);

    if (!Object.keys(evidence).length) {
      throw new AppError("Add at least one piece of dispute evidence before submitting", 400);
    }

    const dispute = await this.getStripeClient().disputes.update(disputeId, {
      evidence,
      submit: true,
    });

    await this.syncDisputeState(payment, dispute, {
      source: "admin_dispute_response",
    });

    await paymentRepository.updateById(payment._id, {
      stripeDisputeSubmittedAt: new Date(),
      stripeDisputeLastAction: "submitted",
      stripeDisputeLastActionBy: user._id,
    });

    return {
      payment: await paymentRepository.findById(payment._id, {
        populate: paymentRepository.buildRelationsPopulate(),
      }),
      dispute,
    };
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
    let session = null;

    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);

      if (!["paid", "failed", "cancelled"].includes(payment.status)) {
        await this.reconcileCheckoutSession(session, {
          source: "status_check",
        });

        payment = await paymentRepository.findBySessionIdWithRelations(sessionId);
      }
    } catch (error) {
      logger.warn(
        {
          err: error,
          paymentId: payment._id,
          sessionId,
        },
        "Unable to refresh Stripe checkout session status"
      );
    }

    const draftJob = payment.metadata?.draftJob || null;

    return {
      payment,
      job: payment.job || null,
      draftJob,
      checkout: {
        id: session?.id || sessionId,
        status: session?.status || "",
        paymentStatus: session?.payment_status || "",
        customerEmail: session?.customer_details?.email || draftJob?.email || "",
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
      const workerTransfer = await this.ensureWorkerTransferForPaidPayment(payment, null, context);

      return {
        status: "already_paid",
        paymentId: String(payment._id),
        bookingId: String(bookingId || ""),
        jobId: String(jobId || payment.job || ""),
        workerTransferStatus: workerTransfer.status,
        workerTransferId: workerTransfer.transferId || "",
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

      if (paymentIntent?.status === "requires_capture" && !this.isAuthorizationExpired(paymentIntent, payment)) {
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

      if (paymentIntent?.status === "requires_capture" && this.isAuthorizationExpired(paymentIntent, payment)) {
        paymentIntent = null;
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

  async processStripeWebhookEvent(event) {
    if (event.type === "checkout.session.completed") {
      await this.reconcileCheckoutSession(event.data.object, {
        source: "webhook",
        stripeEventId: event.id,
        stripeEventType: event.type,
      });
    }

    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object;
      const failedPayment = await this.findPaymentForPaymentIntent(paymentIntent);

      if (failedPayment) {
        await paymentRepository.updateById(
          failedPayment._id,
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

        if (failedPayment.job) {
          await this.syncJobPaymentState(failedPayment.job, {
            paymentStatus: "failed",
            isPaid: false,
          });
        }
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const paidPayment = await this.findPaymentForPaymentIntent(paymentIntent);

      if (paidPayment) {
        await this.reconcilePaidCheckoutSession(
          paidPayment,
          {
            id: paidPayment.stripeCheckoutSessionId || `payment_intent_${paymentIntent.id}`,
            payment_intent: paymentIntent.id,
            customer: paymentIntent.customer || paidPayment.stripeCustomerId || "",
          },
          paymentIntent,
          {
            source: "webhook",
            stripeEventId: event.id,
            stripeEventType: event.type,
          }
        );
      }
    }

    if (
      event.type === "refund.created" ||
      event.type === "refund.updated" ||
      event.type === "refund.failed"
    ) {
      const refund = event.data.object;
      const refundedPayment = await this.findPaymentForChargeId(this.getChargeIdFromRefund(refund));

      if (refundedPayment) {
        if (event.type === "refund.failed" || refund.status === "failed") {
          await this.syncFailedRefundState(refundedPayment, refund, {
            source: "webhook",
            stripeEventId: event.id,
            stripeEventType: event.type,
          });
        } else {
          await this.syncRefundState(refundedPayment, refund, {
            source: "webhook",
            stripeEventId: event.id,
            stripeEventType: event.type,
          });
        }
      }
    }

    if (
      event.type === "charge.dispute.created" ||
      event.type === "charge.dispute.updated" ||
      event.type === "charge.dispute.closed" ||
      event.type === "charge.dispute.funds_withdrawn" ||
      event.type === "charge.dispute.funds_reinstated"
    ) {
      const dispute = event.data.object;
      const disputedPayment =
        (await paymentRepository.findByDisputeId(dispute.id)) ||
        (await this.findPaymentForChargeId(this.getChargeIdFromDispute(dispute)));

      if (disputedPayment) {
        const updatedPayment = await this.syncDisputeState(disputedPayment, dispute, {
          source: "webhook",
          stripeEventId: event.id,
          stripeEventType: event.type,
        });

        if (event.type === "charge.dispute.funds_withdrawn") {
          await paymentRepository.updateById(disputedPayment._id, {
            stripeDisputeFundsWithdrawnAt: new Date(),
          });

          if (updatedPayment?.worker && updatedPayment?.stripeTransferId) {
            try {
              await this.createTransferReversalForAdjustment(
                updatedPayment,
                Number(updatedPayment.workerPayout || updatedPayment.amount || 0),
                {
                  reason: `Dispute ${dispute.id}`,
                  metadata: {
                    disputeId: dispute.id,
                  },
                  idempotencyKeySuffix: dispute.id,
                }
              );
            } catch (error) {
              logger.error(
                {
                  err: error,
                  paymentId: updatedPayment._id,
                  disputeId: dispute.id,
                },
                "Stripe transfer reversal failed after dispute funds withdrawal"
              );
            }
          }
        }

        if (event.type === "charge.dispute.funds_reinstated") {
          await paymentRepository.updateById(disputedPayment._id, {
            stripeDisputeOutcome: String(dispute.status || "won").trim(),
          });
        }

        if (event.type === "charge.dispute.created") {
          await Promise.allSettled([
            notificationService.notifyAdmins(
              {
                type: "payment_dispute_opened",
                category: "payment",
                title: "Payment dispute opened",
                message: `Stripe dispute ${dispute.id} was opened for payment ${disputedPayment._id}.`,
                link: `/payment-details`,
                entityType: "payment",
                entityId: String(disputedPayment._id),
              },
              { preferenceKey: "paymentIssues" }
            ),
            notificationService.createForUser(disputedPayment.customer, {
              type: "payment_dispute_opened",
              recipientRole: ROLES.CUSTOMER,
              category: "payment",
              title: "Payment dispute under review",
              message: "Your payment is currently under dispute review with Stripe.",
              link: `/payment-history`,
              entityType: "payment",
              entityId: String(disputedPayment._id),
            }),
          ]);
        }
      }
    }

    if (event.type === "account.updated" || event.type === "account.external_account.updated") {
      const connectedAccountId = event.account || event.data.object?.id || "";

      if (connectedAccountId) {
        await userRepository.findByStripeConnectedAccountId(connectedAccountId).then(async (user) => {
          if (!user) {
            return null;
          }

          const account = await this.getStripeClient().accounts.retrieve(connectedAccountId, {
            expand: ["external_accounts"],
          });

          return userRepository.updateById(user._id, {
            stripeConnectedAccountId: account.id,
            stripeConnectCountry: String(account.country || "US").toUpperCase(),
            stripeConnectBusinessType: String(account.business_type || "individual").trim(),
            stripeConnectDefaultCurrency: String(account.default_currency || "usd").toLowerCase(),
            stripeConnectDetailsSubmitted: Boolean(account.details_submitted),
            stripeConnectChargesEnabled: Boolean(account.charges_enabled),
            stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
            stripeConnectRequirementsDue: Array.isArray(account.requirements?.currently_due)
              ? account.requirements.currently_due
              : [],
            stripeConnectDisabledReason: String(
              account.requirements?.disabled_reason || account.disabled_reason || ""
            ).trim(),
            stripeConnectOnboardingCompletedAt:
              account.details_submitted && account.payouts_enabled
                ? user.stripeConnectOnboardingCompletedAt || new Date()
                : null,
            stripeConnectLastSyncedAt: new Date(),
            stripeExternalAccountId: String(
              account.external_accounts?.data?.find((item) => item?.object === "bank_account")?.id ||
                ""
            ),
            stripeExternalAccountBankName: String(
              account.external_accounts?.data?.find((item) => item?.object === "bank_account")
                ?.bank_name || ""
            ).trim(),
            stripeExternalAccountLast4: String(
              account.external_accounts?.data?.find((item) => item?.object === "bank_account")
                ?.last4 || ""
            ).trim(),
            stripeExternalAccountCurrency: String(
              account.external_accounts?.data?.find((item) => item?.object === "bank_account")
                ?.currency || ""
            ).toLowerCase(),
          });
        });
      }
    }

    if (event.type === "payout.paid" || event.type === "payout.failed" || event.type === "payout.updated") {
      const connectedAccountId = event.account || "";
      const payout = event.data.object;

      if (connectedAccountId) {
        const connectedUser = await userRepository.findByStripeConnectedAccountId(connectedAccountId);

        if (connectedUser) {
          await userRepository.updateById(connectedUser._id, {
            stripeLastPayoutId: String(payout?.id || ""),
            stripeLastPayoutStatus: String(payout?.status || ""),
            stripeLastPayoutFailureCode: String(payout?.failure_code || ""),
            stripeLastPayoutFailureMessage: String(payout?.failure_message || "").slice(0, 500),
            stripeLastPayoutArrivalDate: payout?.arrival_date
              ? new Date(Number(payout.arrival_date) * 1000)
              : null,
            stripeLastPayoutUpdatedAt: new Date(),
          });
        }
      }
    }

    if (event.type === "checkout.session.expired") {
      await this.reconcileCheckoutSession(event.data.object, {
        source: "webhook",
        stripeEventId: event.id,
        stripeEventType: event.type,
      });
    }
  }

  async processPendingStripeWebhookEvents(trigger = "manual") {
    if (this.webhookRunInProgress) {
      return;
    }

    this.webhookRunInProgress = true;

    try {
      let processedCount = 0;

      while (processedCount < WEBHOOK_EVENT_BATCH_SIZE) {
        const queuedEvent = await stripeWebhookEventRepository.acquireNextPendingEvent(
          new Date(Date.now() - WEBHOOK_EVENT_LOCK_TIMEOUT_MS)
        );

        if (!queuedEvent) {
          break;
        }

        try {
          await this.processStripeWebhookEvent(queuedEvent.payload);
          await stripeWebhookEventRepository.markProcessed(queuedEvent._id);
        } catch (error) {
          await stripeWebhookEventRepository.markFailed(
            queuedEvent._id,
            this.normalizeRepairErrorMessage(error)
          );
          logger.error(
            {
              err: error,
              stripeEventId: queuedEvent.stripeEventId,
              stripeEventType: queuedEvent.type,
              trigger,
            },
            "Stripe webhook event processing failed"
          );
        }

        processedCount += 1;
      }
    } finally {
      this.webhookRunInProgress = false;
    }
  }

  startWebhookProcessingLoop() {
    if (!env.stripeSecretKey || !env.stripeWebhookSecret) {
      logger.info("Stripe webhook processing loop is disabled");
      return;
    }

    if (this.webhookIntervalHandle) {
      return;
    }

    setImmediate(() => {
      this.processPendingStripeWebhookEvents("startup");
    });

    this.webhookIntervalHandle = setInterval(() => {
      this.processPendingStripeWebhookEvents("interval");
    }, WEBHOOK_EVENT_INTERVAL_MS);
    this.webhookIntervalHandle.unref?.();

    logger.info(
      {
        intervalMs: WEBHOOK_EVENT_INTERVAL_MS,
        batchSize: WEBHOOK_EVENT_BATCH_SIZE,
      },
      "Stripe webhook processing loop started"
    );
  }

  async handleStripeWebhook(rawBody, signature) {
    return this.enqueueStripeWebhookEvent(rawBody, signature);
  }
}

module.exports = new PaymentService();
