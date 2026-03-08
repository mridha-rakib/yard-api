const Booking = require("./booking.model");
const Job = require("../job/job.model");


// 🔹 Worker accept job → create booking
const createBooking = async (req, res) => {
  try {
    const { jobId } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const booking = await Booking.create({
      jobId,
      customerId: job.createdBy,
      workerId: req.user.id
    });

    res.json({ message: "Booking created", booking });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// 🔹 Worker mark complete
const completeBooking = async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(
    req.params.id,
    { status: "completed" },
    { new: true }
  );

  res.json(booking);
};


// 🔹 Customer cancel
const cancelBooking = async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(
    req.params.id,
    { status: "cancelled" },
    { new: true }
  );

  res.json(booking);
};


// 🔹 Admin get all bookings
const getAllBookings = async (req, res) => {
  const bookings = await Booking.find()
    .populate("jobId")
    .populate("customerId")
    .populate("workerId");

  res.json(bookings);
};

module.exports = {
  createBooking,
  completeBooking,
  cancelBooking,
  getAllBookings
};