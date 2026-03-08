const Content = require("./content.model");

const updateContent = async (req, res) => {
  const updated = await Content.findOneAndUpdate(
    { type: req.params.type },
    { content: req.body.content },
    { new: true, upsert: true }
  );

  res.json(updated);
};

const getContent = async (req, res) => {
  const content = await Content.findOne({ type: req.params.type });
  res.json(content);
};

const getDashboardStats = async (req, res) => {
  const totalUsers = await User.countDocuments();
  const totalWorkers = await User.countDocuments({ role: "worker" });
  const totalBookings = await Booking.countDocuments();
  const totalPayments = await Payment.countDocuments();

  res.json({
    totalUsers,
    totalWorkers,
    totalBookings,
    totalPayments
  });
};

module.exports = {
  updateContent,
  getContent,
  getDashboardStats
};