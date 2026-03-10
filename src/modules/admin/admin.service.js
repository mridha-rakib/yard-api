const bcrypt = require("bcryptjs");
const env = require("../../config/env");
const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const { USER_STATUSES } = require("../../constants/statuses");
const userRepository = require("../users/user.repository");
const jobRepository = require("../jobs/job.repository");
const bookingRepository = require("../bookings/booking.repository");
const bookingService = require("../bookings/booking.service");
const paymentRepository = require("../payments/payment.repository");
const supportRepository = require("../support/support.repository");
const contentRepository = require("../content/content.repository");

class AdminService {
  buildSearchFilter(query = {}, fields = []) {
    if (!query.search) {
      return {};
    }

    return {
      $or: fields.map((field) => ({
        [field]: { $regex: query.search, $options: "i" },
      })),
    };
  }

  async seedAdmin() {
    const existingAdminCount = await userRepository.count({ role: ROLES.ADMIN });

    if (existingAdminCount > 0) {
      return {
        status: "skipped",
        reason: "admin_exists",
      };
    }

    if (!env.adminPassword) {
      throw new AppError(
        "ADMIN_PASSWORD is required to seed the initial admin account",
        500
      );
    }

    const [existingEmailUser, existingPhoneUser] = await Promise.all([
      userRepository.findByEmail(env.adminEmail),
      userRepository.findByPhone(env.adminPhone),
    ]);

    if (existingEmailUser) {
      throw new AppError(
        `Cannot seed admin because ${env.adminEmail} is already assigned to another account`,
        409
      );
    }

    if (existingPhoneUser) {
      throw new AppError(
        `Cannot seed admin because ${env.adminPhone} is already assigned to another account`,
        409
      );
    }

    const hashedPassword = await bcrypt.hash(env.adminPassword, 10);

    let admin;

    try {
      admin = await userRepository.create({
        name: env.adminName,
        email: env.adminEmail,
        phone: env.adminPhone,
        password: hashedPassword,
        role: ROLES.ADMIN,
        status: "active",
        workerStatus: "not_applicable",
      });
    } catch (error) {
      if (error?.code === 11000) {
        const adminCountAfterConflict = await userRepository.count({ role: ROLES.ADMIN });

        if (adminCountAfterConflict > 0) {
          return {
            status: "skipped",
            reason: "admin_exists",
          };
        }
      }

      throw error;
    }

    return {
      status: "created",
      adminId: String(admin._id),
      email: admin.email,
    };
  }

  async getDashboardStats() {
    const [
      totalUsers,
      totalWorkers,
      pendingWorkers,
      totalCustomers,
      totalJobs,
      totalBookings,
      totalPayments,
      totalSupportConversations,
      totalRevenueResult,
    ] = await Promise.all([
      userRepository.count({}),
      userRepository.count({ role: "worker" }),
      userRepository.count({ role: "worker", workerStatus: "pending" }),
      userRepository.count({ role: "customer" }),
      jobRepository.count({}),
      bookingRepository.count({}),
      paymentRepository.count({}),
      supportRepository.count({}),
      paymentRepository.model.aggregate([
        {
          $match: {
            status: "paid",
          },
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            totalPlatformFee: { $sum: "$platformFee" },
            totalWorkerPayout: { $sum: "$workerPayout" },
          },
        },
      ]),
    ]);

    const revenue = totalRevenueResult[0] || {
      totalAmount: 0,
      totalPlatformFee: 0,
      totalWorkerPayout: 0,
    };

    return {
      totalUsers,
      totalWorkers,
      pendingWorkers,
      totalCustomers,
      totalJobs,
      totalBookings,
      totalPayments,
      totalSupportConversations,
      totalRevenue: revenue.totalAmount,
      totalPlatformFee: revenue.totalPlatformFee,
      totalWorkerPayout: revenue.totalWorkerPayout,
    };
  }

  async listWorkers(query = {}) {
    const pagination = buildPagination(query);
    const filter = {
      ...this.buildSearchFilter(query, ["name", "email", "phone"]),
    };

    if (query.status) {
      filter.workerStatus = query.status;
    }

    if (query.skill) {
      filter.skills = query.skill;
    }

    return userRepository.listWorkers(filter, {
      ...pagination,
      sort: { createdAt: -1 },
      select: "-password",
    });
  }

  async getWorkerFilters() {
    const skills = await userRepository.model.distinct("skills", {
      role: ROLES.WORKER,
      skills: { $exists: true, $ne: [] },
    });

    return {
      skills: skills.filter(Boolean).sort((left, right) => left.localeCompare(right)),
    };
  }

  async getWorkerById(workerId) {
    const worker = await userRepository.findById(workerId, { select: "-password" });
    if (!worker || worker.role !== "worker") {
      throw new AppError("Worker not found", 404);
    }

    return worker;
  }

  async updateWorkerStatus(workerId, workerStatus) {
    const worker = await this.getWorkerById(workerId);
    await userRepository.updateById(worker._id, { workerStatus });
    return this.getWorkerById(worker._id);
  }

  async updateWorkerAccountStatus(workerId, status) {
    const worker = await this.getWorkerById(workerId);

    if (!USER_STATUSES.includes(status)) {
      throw new AppError("Invalid worker account status", 400);
    }

    await userRepository.updateById(worker._id, { status });
    return this.getWorkerById(worker._id);
  }

  async listCustomers(query = {}) {
    const pagination = buildPagination(query);
    const filter = {
      ...this.buildSearchFilter(query, ["name", "email", "phone"]),
    };

    return userRepository.listCustomers(filter, {
      ...pagination,
      sort: { createdAt: -1 },
      select: "-password",
    });
  }

  async getCustomerById(customerId) {
    const customer = await userRepository.findById(customerId, { select: "-password" });
    if (!customer || customer.role !== "customer") {
      throw new AppError("Customer not found", 404);
    }

    return customer;
  }

  async listBookings(query = {}) {
    const pagination = buildPagination(query);
    const filter = {};

    if (query.status) {
      filter.status = query.status;
    }

    return bookingRepository.paginateWithRelations(filter, {
      ...pagination,
      sort: { createdAt: -1 },
    });
  }

  async updateBookingStatus(adminUser, bookingId, status) {
    return bookingService.updateBookingStatusByAdmin(adminUser, bookingId, status);
  }

  async listPayments(query = {}) {
    const pagination = buildPagination(query);
    const filter = {};

    if (query.status) {
      filter.status = query.status;
    }

    return paymentRepository.paginateWithRelations(filter, {
      ...pagination,
      sort: { createdAt: -1 },
    });
  }

  async listSupportConversations(query = {}) {
    const pagination = buildPagination(query);
    const filter = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search) {
      filter.$or = [
        { subject: { $regex: query.search, $options: "i" } },
        { requesterName: { $regex: query.search, $options: "i" } },
        { requesterEmail: { $regex: query.search, $options: "i" } },
      ];
    }

    return supportRepository.paginateConversations(filter, {
      ...pagination,
      sort: { lastMessageAt: -1 },
    });
  }

  async getSettings() {
    const [platformSettings, paymentSettings, legalDocs] = await Promise.all([
      contentRepository.findByKey("platform-settings"),
      contentRepository.findByKey("payment-settings"),
      contentRepository.findByKey("legal-docs"),
    ]);

    return {
      platformSettings: platformSettings?.value || {
        name: "Yard Platform",
        email: "",
        phone: "",
      },
      paymentSettings: paymentSettings?.value || {
        platformFee: 12,
        minimumServiceAmount: 0,
        paymentProcessor: "stripe",
      },
      legalDocs: legalDocs?.value || [],
    };
  }

  async updateSettings(payload) {
    const updates = [];

    if (payload.platformSettings) {
      updates.push(
        contentRepository.updateOne(
          { key: "platform-settings" },
          {
            key: "platform-settings",
            title: "Platform Settings",
            value: payload.platformSettings,
            isPublic: false,
          },
          { upsert: true }
        )
      );
    }

    if (payload.paymentSettings) {
      updates.push(
        contentRepository.updateOne(
          { key: "payment-settings" },
          {
            key: "payment-settings",
            title: "Payment Settings",
            value: payload.paymentSettings,
            isPublic: false,
          },
          { upsert: true }
        )
      );
    }

    if (payload.legalDocs) {
      updates.push(
        contentRepository.updateOne(
          { key: "legal-docs" },
          {
            key: "legal-docs",
            title: "Legal Documents",
            value: payload.legalDocs,
            isPublic: false,
          },
          { upsert: true }
        )
      );
    }

    await Promise.all(updates);

    return this.getSettings();
  }
}

module.exports = new AdminService();
