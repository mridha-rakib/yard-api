const StripeWebhookEvent = require("./stripe-webhook-event.model");

class StripeWebhookEventRepository {
  upsertPendingEvent(event) {
    return StripeWebhookEvent.findOneAndUpdate(
      {
        stripeEventId: String(event?.id || "").trim(),
      },
      {
        $setOnInsert: {
          stripeEventId: String(event?.id || "").trim(),
          type: String(event?.type || "").trim(),
          payload: event,
          status: "pending",
          attempts: 0,
          receivedAt: new Date(),
          processedAt: null,
          processingLockedAt: null,
          lastError: "",
        },
      },
      {
        new: true,
        upsert: true,
      }
    );
  }

  acquireNextPendingEvent(staleBefore) {
    return StripeWebhookEvent.findOneAndUpdate(
      {
        status: { $in: ["pending", "failed"] },
        $or: [
          { processingLockedAt: null },
          { processingLockedAt: { $lt: staleBefore } },
        ],
      },
      {
        status: "processing",
        processingLockedAt: new Date(),
        $inc: { attempts: 1 },
      },
      {
        new: true,
        sort: { receivedAt: 1, createdAt: 1 },
      }
    );
  }

  markProcessed(eventId) {
    return StripeWebhookEvent.findByIdAndUpdate(
      eventId,
      {
        status: "processed",
        processedAt: new Date(),
        processingLockedAt: null,
        lastError: "",
      },
      {
        new: true,
        runValidators: true,
      }
    );
  }

  markFailed(eventId, errorMessage) {
    return StripeWebhookEvent.findByIdAndUpdate(
      eventId,
      {
        status: "failed",
        processingLockedAt: null,
        lastError: String(errorMessage || "").slice(0, 500),
      },
      {
        new: true,
        runValidators: true,
      }
    );
  }
}

module.exports = new StripeWebhookEventRepository();
