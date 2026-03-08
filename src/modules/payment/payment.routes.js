const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../../middleware/authMiddleware");
const paymentController = require("./payment.controller");

router.post(
  "/create-checkout-session",
  protect,
  authorize("employer"),
  paymentController.createPayment
);

module.exports = router;