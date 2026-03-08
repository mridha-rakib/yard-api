const express = require("express");
const cors = require("cors");
require("dotenv").config();
const userRoutes = require("./modules/user/user.routes");
const jobRoutes = require("./modules/job/job.routes");
const applicationRoutes = require("./modules/application/application.route");
const paymentRoutes = require("./modules/payment/payment.routes");
const paymentController = require("./modules/payment/payment.controller");
const bookingRoutes = require("./modules/booking/booking.routes");



const connectDB = require("./config/db");
const app = express();

// 🔥 Stripe Webhook Route (must be before express.json)
app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json" }),
  paymentController.handleWebhook
);


// Middleware
app.use(cors());
app.use(express.json());
app.use("/api/users", userRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/payment", paymentRoutes);
app.use("api/bookings", bookingRoutes);

// Connect to Database
connectDB();

// Test Route
app.get("/", (req, res) => {
  res.send("Yard Backend Running 🚀");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});