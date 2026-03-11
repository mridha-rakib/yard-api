const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const paymentController = require("./payment.controller");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { ROLES } = require("../../constants/roles");

const router = express.Router();

router.use(authenticate);
router.get("/", asyncHandler(paymentController.listPayments));
router.get(
  "/checkout/session/:sessionId",
  authorize(ROLES.CUSTOMER, ROLES.ADMIN),
  asyncHandler(paymentController.getCheckoutSessionStatus)
);
router.post(
  "/checkout/job-request",
  authorize(ROLES.CUSTOMER, ROLES.ADMIN),
  asyncHandler(paymentController.createCheckoutSession)
);
router.get("/:paymentId", asyncHandler(paymentController.getPaymentById));

module.exports = router;
