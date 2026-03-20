const express = require("express");
const authRoutes = require("../modules/auth/auth.routes");
const userRoutes = require("../modules/users/user.routes");
const jobRoutes = require("../modules/jobs/job.routes");
const applicationRoutes = require("../modules/applications/application.routes");
const bookingRoutes = require("../modules/bookings/booking.routes");
const paymentRoutes = require("../modules/payments/payment.routes");
const supportRoutes = require("../modules/support/support.routes");
const contentRoutes = require("../modules/content/content.routes");
const testimonialRoutes = require("../modules/testimonials/testimonial.routes");
const adminRoutes = require("../modules/admin/admin.routes");
const notificationRoutes = require("../modules/notifications/notification.routes");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Yard API is running",
    timestamp: new Date().toISOString(),
  });
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/jobs", jobRoutes);
router.use("/applications", applicationRoutes);
router.use("/bookings", bookingRoutes);
router.use("/payments", paymentRoutes);
router.use("/support", supportRoutes);
router.use("/content", contentRoutes);
router.use("/testimonials", testimonialRoutes);
router.use("/admin", adminRoutes);
router.use("/notifications", notificationRoutes);

module.exports = router;
