const paymentService = require("./payment.service");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const Job = require("../job/job.model");

const createPayment = async (req, res) => {
  try {
    const session = await paymentService.createCheckoutSession(
      req.body,
      req.user.id
    );

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("Webhook signature failed.");
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Payment success হলে
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const jobData = JSON.parse(session.metadata.jobData);
    const userId = session.metadata.userId;

    try {
      await Job.create({
        ...jobData,
        createdBy: userId,
        isPaid: true,
      });

      console.log("✅ Job created after payment");
    } catch (error) {
      console.log("Job save error:", error.message);
    }
  }

  res.json({ received: true });
};
 

module.exports = { createPayment, handleWebhook };