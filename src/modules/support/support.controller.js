const Support = require("./support.model");

const sendMessage = async (req, res) => {
  const message = await Support.create({
    userId: req.user.id,
    sender: req.user.role === "admin" ? "admin" : "user",
    message: req.body.message
  });

  res.json(message);
};

const getConversation = async (req, res) => {
  const messages = await Support.find({ userId: req.params.userId });
  res.json(messages);
};