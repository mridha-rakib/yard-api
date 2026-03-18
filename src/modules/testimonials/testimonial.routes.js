const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const testimonialController = require("./testimonial.controller");
const {
  authenticate,
  optionalAuthenticate,
} = require("../../middleware/auth.middleware");

const router = express.Router();

router.get("/", optionalAuthenticate, asyncHandler(testimonialController.listTestimonials));
router.get("/me", authenticate, asyncHandler(testimonialController.getOwnTestimonial));
router.post("/", authenticate, asyncHandler(testimonialController.upsertOwnTestimonial));

module.exports = router;
