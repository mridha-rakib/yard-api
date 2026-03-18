const testimonialService = require("./testimonial.service");

class TestimonialController {
  async listTestimonials(req, res) {
    const testimonials = await testimonialService.listTestimonials(req.query, req.user);

    res.json({
      success: true,
      data: testimonials,
    });
  }

  async getOwnTestimonial(req, res) {
    const testimonial = await testimonialService.getOwnTestimonial(req.user);

    res.json({
      success: true,
      data: testimonial,
    });
  }

  async upsertOwnTestimonial(req, res) {
    const testimonial = await testimonialService.upsertOwnTestimonial(req.user, req.body);

    res.json({
      success: true,
      message: "Review saved successfully",
      data: testimonial,
    });
  }
}

module.exports = new TestimonialController();
