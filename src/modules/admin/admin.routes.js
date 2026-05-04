const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const adminController = require("./admin.controller");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { ROLES } = require("../../constants/roles");

const router = express.Router();

router.use(authenticate, authorize(ROLES.ADMIN));

router.get("/dashboard", asyncHandler(adminController.getDashboardStats));
router.get("/workers", asyncHandler(adminController.listHeroes));
router.get("/workers/meta", asyncHandler(adminController.getHeroFilters));
router.get("/workers/:workerId", asyncHandler(adminController.getHeroById));
router.patch("/workers/:workerId/approve", asyncHandler(adminController.approveHero));
router.patch("/workers/:workerId/reject", asyncHandler(adminController.rejectHero));
router.delete("/workers/:workerId", asyncHandler(adminController.deleteHero));
router.patch(
  "/workers/:workerId/account-status",
  asyncHandler(adminController.updateHeroAccountStatus)
);
router.get("/customers", asyncHandler(adminController.listCustomers));
router.get("/customers/:customerId", asyncHandler(adminController.getCustomerById));
router.get("/testimonials", asyncHandler(adminController.listTestimonials));
router.get("/bookings", asyncHandler(adminController.listBookings));
router.get("/bookings/:jobId", asyncHandler(adminController.getBookingById));
router.patch("/bookings/:bookingId/status", asyncHandler(adminController.updateBookingStatus));
router.patch(
  "/bookings/:bookingId/approve-completion",
  asyncHandler(adminController.approveBookingCompletion)
);
router.get("/payments", asyncHandler(adminController.listPayments));
router.get("/support", asyncHandler(adminController.listSupportConversations));
router.get("/pricing", asyncHandler(adminController.getPricingRules));
router.put("/pricing", asyncHandler(adminController.updatePricingRules));
router.get("/settings", asyncHandler(adminController.getSettings));
router.patch("/settings", asyncHandler(adminController.updateSettings));

module.exports = router;
