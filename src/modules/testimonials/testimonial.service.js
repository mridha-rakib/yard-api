const AppError = require("../../errors/AppError");
const { ROLES } = require("../../constants/roles");
const { hasRole } = require("../../utils/user-roles");
const testimonialRepository = require("./testimonial.repository");

const DEFAULT_LIMIT = 24;
const MIN_REVIEW_LENGTH = 20;
const MAX_REVIEW_LENGTH = 600;
const MAX_LOCATION_LENGTH = 80;

const buildDisplayName = (name = "") => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "Verified Customer";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${parts[0]} ${lastInitial}.`;
};

const buildLocationLabel = (user, explicitLocation = "") => {
  const manualLocation = String(explicitLocation || "").trim();

  if (manualLocation) {
    return manualLocation;
  }

  return [user?.location?.city, user?.location?.state].filter(Boolean).join(", ");
};

class TestimonialService {
  ensureCustomerUser(user) {
    if (!user) {
      throw new AppError("Authentication is required", 401);
    }

    if (hasRole(user, ROLES.ADMIN) || !hasRole(user, ROLES.CUSTOMER)) {
      throw new AppError("Only signed-in customers can leave reviews", 403);
    }
  }

  normalizeLimit(value) {
    const parsedValue = Number(value || DEFAULT_LIMIT);

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(parsedValue), 50);
  }

  normalizeRating(value) {
    const rating = Number(value);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError("Rating must be a whole number between 1 and 5", 400);
    }

    return rating;
  }

  normalizeText(value) {
    const text = String(value || "").trim();

    if (text.length < MIN_REVIEW_LENGTH) {
      throw new AppError(
        `Review must be at least ${MIN_REVIEW_LENGTH} characters long`,
        400
      );
    }

    if (text.length > MAX_REVIEW_LENGTH) {
      throw new AppError(
        `Review must be ${MAX_REVIEW_LENGTH} characters or fewer`,
        400
      );
    }

    return text;
  }

  normalizeLocation(user, value) {
    const location = buildLocationLabel(user, value);

    if (location.length > MAX_LOCATION_LENGTH) {
      throw new AppError(
        `Location must be ${MAX_LOCATION_LENGTH} characters or fewer`,
        400
      );
    }

    return location;
  }

  serializeTestimonial(testimonial, currentUserId = null) {
    const customerId = testimonial?.customer?._id || testimonial?.customer || null;

    return {
      id: String(testimonial?._id || ""),
      customerId: customerId ? String(customerId) : "",
      name: testimonial?.displayName || "Verified Customer",
      role: "Verified Customer",
      rating: Number(testimonial?.rating || 0),
      text: testimonial?.text || "",
      location: testimonial?.location || "",
      createdAt: testimonial?.createdAt || null,
      updatedAt: testimonial?.updatedAt || null,
      isOwn:
        Boolean(currentUserId && customerId) &&
        String(customerId) === String(currentUserId),
    };
  }

  async listTestimonials(query = {}, user = null) {
    const limit = this.normalizeLimit(query.limit);
    const result = await testimonialRepository.paginate(
      {},
      {
        page: 1,
        limit,
        sort: { updatedAt: -1, createdAt: -1 },
        lean: true,
      }
    );

    return result.items.map((testimonial) =>
      this.serializeTestimonial(testimonial, user?._id)
    );
  }

  async getOwnTestimonial(user) {
    this.ensureCustomerUser(user);

    const testimonial = await testimonialRepository.findByCustomerId(user._id, {
      lean: true,
    });

    return testimonial ? this.serializeTestimonial(testimonial, user._id) : null;
  }

  async upsertOwnTestimonial(user, payload = {}) {
    this.ensureCustomerUser(user);

    const normalizedPayload = {
      displayName: buildDisplayName(user.name),
      rating: this.normalizeRating(payload.rating),
      text: this.normalizeText(payload.text),
      location: this.normalizeLocation(user, payload.location),
    };

    const existingTestimonial = await testimonialRepository.findByCustomerId(user._id, {
      lean: true,
      select: "_id customer",
    });

    const testimonial = existingTestimonial
      ? await testimonialRepository.updateById(existingTestimonial._id, normalizedPayload)
      : await testimonialRepository.create({
          customer: user._id,
          ...normalizedPayload,
        });

    return this.serializeTestimonial(testimonial, user._id);
  }
}

module.exports = new TestimonialService();
