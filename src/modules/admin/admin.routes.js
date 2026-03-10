const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const adminController = require("./admin.controller");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { ROLES } = require("../../constants/roles");

const router = express.Router();

router.use(authenticate, authorize(ROLES.ADMIN));

router.get("/dashboard", asyncHandler(adminController.getDashboardStats));
router.get("/workers", asyncHandler(adminController.listWorkers));
router.get("/workers/meta", asyncHandler(adminController.getWorkerFilters));
router.get("/workers/:workerId", asyncHandler(adminController.getWorkerById));
router.patch("/workers/:workerId/approve", asyncHandler(adminController.approveWorker));
router.patch("/workers/:workerId/reject", asyncHandler(adminController.rejectWorker));
router.patch(
  "/workers/:workerId/account-status",
  asyncHandler(adminController.updateWorkerAccountStatus)
);
router.get("/customers", asyncHandler(adminController.listCustomers));
router.get("/customers/:customerId", asyncHandler(adminController.getCustomerById));
router.get("/bookings", asyncHandler(adminController.listBookings));
router.patch("/bookings/:bookingId/status", asyncHandler(adminController.updateBookingStatus));
router.get("/payments", asyncHandler(adminController.listPayments));
router.get("/support", asyncHandler(adminController.listSupportConversations));
router.get("/settings", asyncHandler(adminController.getSettings));
router.patch("/settings", asyncHandler(adminController.updateSettings));

module.exports = router;
