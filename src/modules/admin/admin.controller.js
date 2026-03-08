const Payment = require("../payment/payment.model");
const User = require("../user/user.model");
const Booking = require("../booking/booking.model");

// 🔹 Get all workers
const getAllWorkers = async (req, res) => {
  const workers = await User.find({ role: "worker" });
  res.json(workers);
};

// 🔹 Get pending workers
const getPendingWorkers = async (req, res) => {
  const workers = await User.find({
    role: "worker",
    workerStatus: "pending",
  });
  res.json(workers);
};

// 🔹 Approve worker
const approveWorker = async (req, res) => {
  const worker = await User.findByIdAndUpdate(
    req.params.id,
    { workerStatus: "approved" },
    { new: true },
  );

  res.json({ message: "Worker approved", worker });
};

// 🔹 Reject worker
const rejectWorker = async (req, res) => {
  const worker = await User.findByIdAndUpdate(
    req.params.id,
    { workerStatus: "rejected" },
    { new: true },
  );

  res.json({ message: "Worker rejected", worker });
};

const getAllCustomers = async (req, res) => {
  const customers = await User.find({ role: "customer" });
  res.json(customers);
};

const getAllBookings = async (req, res) => {
  const bookings = await Booking.find()
    .populate("customerId")
    .populate("workerId")
    .populate("jobId");
  res.json(bookings);
};
const updateBookingStatus = async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true },
  );
  res.json(booking);
};


const getAllPayments = async (req, res) => {
  const payments = await Payment.find()
    .populate("customerId")
    .populate("workerId")
    .populate("jobId");

  res.json(payments);
};

module.exports = {
  getAllWorkers,
  getPendingWorkers,
  approveWorker,
  rejectWorker,
  getAllCustomers,
  getAllBookings,
  updateBookingStatus
};
