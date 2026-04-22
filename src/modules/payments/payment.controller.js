const paymentService = require("./payment.service");

class PaymentController {
  async createCheckoutSession(req, res) {
    const result = await paymentService.createJobCheckoutSession(req.user, req.body);
    res.status(201).json({
      success: true,
      message: "Checkout session created successfully",
      data: result,
    });
  }

  async getCheckoutSessionStatus(req, res) {
    const result = await paymentService.getCheckoutSessionStatus(
      req.user,
      req.params.sessionId
    );

    res.json({
      success: true,
      data: result,
    });
  }

  async listPayments(req, res) {
    const result = await paymentService.listPayments(req.user, req.query);
    res.json({ success: true, ...result });
  }

  async getPaymentById(req, res) {
    const payment = await paymentService.getPaymentById(req.user, req.params.paymentId);
    res.json({ success: true, data: payment });
  }

  async refundPayment(req, res) {
    const result = await paymentService.refundPayment(
      req.user,
      req.params.paymentId,
      req.body
    );

    res.json({
      success: true,
      message: "Refund created successfully",
      data: result,
    });
  }

  async acceptDispute(req, res) {
    const result = await paymentService.acceptDispute(req.user, req.params.paymentId);

    res.json({
      success: true,
      message: "Dispute accepted successfully",
      data: result,
    });
  }

  async submitDisputeEvidence(req, res) {
    const result = await paymentService.submitDisputeEvidence(
      req.user,
      req.params.paymentId,
      req.body
    );

    res.json({
      success: true,
      message: "Dispute response submitted successfully",
      data: result,
    });
  }

  async handleWebhook(req, res, next) {
    try {
      const result = await paymentService.handleStripeWebhook(
        req.body,
        req.headers["stripe-signature"]
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PaymentController();
