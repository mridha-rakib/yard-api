const BaseRepository = require("../../utils/base.repository");
const Booking = require("./booking.model");

class BookingRepository extends BaseRepository {
  constructor() {
    super(Booking);
  }

  findByJob(jobId, options = {}) {
    return this.findOne({ job: jobId }, options);
  }

  findBookingWithRelations(bookingId) {
    return this.findById(bookingId, {
      populate: [
        {
          path: "job",
        },
        {
          path: "customer",
          select: "name email phone",
        },
        {
          path: "worker",
          select: "name email phone skills profilePhotoUrl workerBio portfolioItems",
        },
        {
          path: "verificationApprovedBy",
          select: "name email",
        },
      ],
    });
  }

  paginateWithRelations(filter = {}, options = {}) {
    return this.paginate(filter, {
      ...options,
      populate: [
        {
          path: "job",
          select:
            "title serviceType streetAddress city zipCode urgency status estimatedPrice paymentStatus",
        },
        {
          path: "customer",
          select: "name email phone",
        },
        {
          path: "worker",
          select: "name email phone workerStatus skills",
        },
      ],
    });
  }
}

module.exports = new BookingRepository();
