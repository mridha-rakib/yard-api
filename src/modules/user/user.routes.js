const express = require("express");
const router = express.Router();
const { register, login } = require("./user.controller");
const { protect, authorize } = require("../../middleware/auth.middleware");


router.post("/register", register);
router.post("/login", login);

router.get("/profile", (req, res) => {
  res.json({ message: "Your  profile",
    user: req.user
   });
});

router.get("/admin", protect, authorize("admin"), (req, res) => {
  res.json({
    message: "Admin Access Granted 🔥",
  });
});

module.exports = router;