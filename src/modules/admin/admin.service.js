const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const env = require("../../config/env");
const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const { USER_STATUSES } = require("../../constants/statuses");
const userRepository = require("../users/user.repository");
const jobRepository = require("../jobs/job.repository");
const jobService = require("../jobs/job.service");
const bookingRepository = require("../bookings/booking.repository");
const bookingService = require("../bookings/booking.service");
const paymentRepository = require("../payments/payment.repository");
const supportRepository = require("../support/support.repository");
const contentRepository = require("../content/content.repository");

const DEFAULT_PLATFORM_SETTINGS = {
  name: "Yard Heroes",
  email: "support@yardheroes.com",
  phone: "+1 (555) 123-4567",
};

const DEFAULT_PAYMENT_SETTINGS = {
  platformFee: 12,
  minimumServiceAmount: 25,
  paymentProcessor: "stripe",
};

const DEFAULT_NOTIFICATION_SETTINGS = {
  newUserRegistrations: true,
  serviceCompletions: true,
  paymentIssues: true,
};

const DEFAULT_LEGAL_DOCS = [
  {
    id: "terms-of-service",
    name: "Terms of Service",
    status: "active",
    body: "",
  },
  {
    id: "privacy-policy",
    name: "Privacy Policy",
    status: "active",
    body: "",
  },
  {
    id: "cookie-policy",
    name: "Cookie Policy",
    status: "active",
    body: "",
  },
  {
    id: "gdpr-compliance",
    name: "GDPR Compliance",
    status: "active",
    body: "",
  },
];

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

  getDefaultLegalDocs() {
    return DEFAULT_LEGAL_DOCS.map((document) => ({ ...document }));
  }

  normalizePlatformSettings(settings = {}) {
    return {
      name: String(settings.name ?? DEFAULT_PLATFORM_SETTINGS.name).trim(),
      email: String(settings.email ?? DEFAULT_PLATFORM_SETTINGS.email)
        .trim()
        .toLowerCase(),
      phone: String(settings.phone ?? DEFAULT_PLATFORM_SETTINGS.phone).trim(),
    };
  }

  normalizePaymentSettings(settings = {}) {
    const platformFee = Number(settings.platformFee ?? DEFAULT_PAYMENT_SETTINGS.platformFee);
    const minimumServiceAmount = Number(
      settings.minimumServiceAmount ?? DEFAULT_PAYMENT_SETTINGS.minimumServiceAmount
    );
    const paymentProcessor = String(
      settings.paymentProcessor ?? DEFAULT_PAYMENT_SETTINGS.paymentProcessor
    )
      .trim()
      .toLowerCase();

    return {
      platformFee: Number.isFinite(platformFee) && platformFee >= 0 ? platformFee : 0,
      minimumServiceAmount:
        Number.isFinite(minimumServiceAmount) && minimumServiceAmount >= 0
          ? minimumServiceAmount
          : 0,
      paymentProcessor: paymentProcessor || DEFAULT_PAYMENT_SETTINGS.paymentProcessor,
    };
  }

  normalizeNotificationSettings(settings = {}) {
    return {
      newUserRegistrations: Boolean(
        settings.newUserRegistrations ?? DEFAULT_NOTIFICATION_SETTINGS.newUserRegistrations
      ),
      serviceCompletions: Boolean(
        settings.serviceCompletions ?? DEFAULT_NOTIFICATION_SETTINGS.serviceCompletions
      ),
      paymentIssues: Boolean(settings.paymentIssues ?? DEFAULT_NOTIFICATION_SETTINGS.paymentIssues),
    };
  }

  normalizeLegalDocs(documents = []) {
    const sourceDocuments =
      Array.isArray(documents) && documents.length ? documents : this.getDefaultLegalDocs();

    return sourceDocuments.map((document, index) => {
      const fallbackDocument = DEFAULT_LEGAL_DOCS[index] || {};
      const normalizedStatus =
        String(document?.status || fallbackDocument.status || "active").toLowerCase() ===
        "inactive"
          ? "inactive"
          : "active";

      return {
        id: String(document?.id || fallbackDocument.id || `document-${index + 1}`).trim(),
        name: String(document?.name || fallbackDocument.name || `Document ${index + 1}`).trim(),
        status: normalizedStatus,
        body: String(document?.body || "").trim(),
      };
    });
  }

  async getAdminProfile(adminUserId) {
    const adminUser = await userRepository.findById(adminUserId, {
      select: "name email phone profilePhotoUrl lastLoginAt role status",
      lean: true,
    });

    if (!adminUser || adminUser.role !== ROLES.ADMIN) {
      throw new AppError("Admin not found", 404);
    }

    return adminUser;
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

  async getDashboardRecentBookings(limit = 5) {
    const recentJobs = await jobRepository.model
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate([
        {
          path: "customer",
          select: "name email phone",
        },
        {
          path: "assignedWorker",
          select: "name email phone workerStatus skills",
        },
      ])
      .lean();

    return jobService.attachOperationalDetails(recentJobs);
  }

  async getDashboardRecentWorkerApplications(limit = 5) {
    return userRepository.model
      .find({ role: ROLES.WORKER })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("name email workerStatus status location profilePhotoUrl createdAt")
      .lean();
  }

  async getDashboardStats() {
    const [
      totalUsers,
      totalWorkers,
      activeWorkers,
      pendingWorkers,
      totalCustomers,
      activeCustomers,
      totalJobs,
      pendingJobs,
      totalBookings,
      totalPayments,
      totalSupportConversations,
      totalRevenueResult,
      recentBookings,
      recentWorkerApplications,
    ] = await Promise.all([
      userRepository.count({}),
      userRepository.count({ role: "worker" }),
      userRepository.count({ role: "worker", workerStatus: "approved", status: "active" }),
      userRepository.count({ role: "worker", workerStatus: "pending" }),
      userRepository.count({ role: "customer" }),
      userRepository.count({ role: "customer", status: "active" }),
      jobRepository.count({}),
      jobRepository.count({ status: "new", assignedWorker: null }),
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
      this.getDashboardRecentBookings(),
      this.getDashboardRecentWorkerApplications(),
    ]);

    const revenue = totalRevenueResult[0] || {
      totalAmount: 0,
      totalPlatformFee: 0,
      totalWorkerPayout: 0,
    };

    return {
      totalUsers,
      totalWorkers,
      activeWorkers,
      pendingWorkers,
      totalCustomers,
      activeCustomers,
      totalJobs,
      pendingJobs,
      totalBookings,
      totalPayments,
      totalSupportConversations,
      totalRevenue: revenue.totalAmount,
      totalPlatformFee: revenue.totalPlatformFee,
      totalWorkerPayout: revenue.totalWorkerPayout,
      recentBookings,
      recentWorkerApplications,
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

  buildCustomerListFilter(query = {}) {
    const filter = {
      role: ROLES.CUSTOMER,
      ...this.buildSearchFilter(query, ["name", "email", "phone"]),
    };

    if (USER_STATUSES.includes(query.status)) {
      filter.status = query.status;
    }

    return filter;
  }

  getCustomerListSort(sortValue = "newest") {
    switch (String(sortValue || "newest").toLowerCase()) {
      case "oldest":
        return { createdAt: 1, _id: 1 };
      case "most_bookings":
        return { totalBookings: -1, createdAt: -1, _id: -1 };
      case "highest_spent":
        return { totalSpent: -1, createdAt: -1, _id: -1 };
      default:
        return { createdAt: -1, _id: -1 };
    }
  }

  async listCustomers(query = {}) {
    const pagination = buildPagination(query);
    const filter = this.buildCustomerListFilter(query);
    const sort = this.getCustomerListSort(query.sort);
    const skip = (pagination.page - 1) * pagination.limit;

    const [result] = await userRepository.model.aggregate([
      {
        $match: filter,
      },
      {
        $lookup: {
          from: jobRepository.model.collection.name,
          let: { customerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$customer", "$$customerId"],
                },
              },
            },
            {
              $group: {
                _id: null,
                totalBookings: { $sum: 1 },
                lastBookingAt: { $max: "$createdAt" },
              },
            },
          ],
          as: "jobMetrics",
        },
      },
      {
        $lookup: {
          from: paymentRepository.model.collection.name,
          let: { customerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$customer", "$$customerId"],
                },
              },
            },
            {
              $group: {
                _id: null,
                totalSpent: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0],
                  },
                },
                paidOrders: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "paid"] }, 1, 0],
                  },
                },
                outstandingBalance: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0],
                  },
                },
                lastPaymentAt: {
                  $max: {
                    $cond: [{ $eq: ["$status", "paid"] }, "$paidAt", null],
                  },
                },
              },
            },
          ],
          as: "paymentMetrics",
        },
      },
      {
        $addFields: {
          jobMetrics: {
            $ifNull: [{ $arrayElemAt: ["$jobMetrics", 0] }, {}],
          },
          paymentMetrics: {
            $ifNull: [{ $arrayElemAt: ["$paymentMetrics", 0] }, {}],
          },
        },
      },
      {
        $addFields: {
          totalBookings: { $ifNull: ["$jobMetrics.totalBookings", 0] },
          lastBookingAt: "$jobMetrics.lastBookingAt",
          totalSpent: { $ifNull: ["$paymentMetrics.totalSpent", 0] },
          paidOrders: { $ifNull: ["$paymentMetrics.paidOrders", 0] },
          outstandingBalance: {
            $ifNull: ["$paymentMetrics.outstandingBalance", 0],
          },
          lastPaymentAt: "$paymentMetrics.lastPaymentAt",
        },
      },
      {
        $addFields: {
          averageOrder: {
            $cond: [
              { $gt: ["$paidOrders", 0] },
              { $divide: ["$totalSpent", "$paidOrders"] },
              0,
            ],
          },
        },
      },
      {
        $project: {
          name: 1,
          email: 1,
          phone: 1,
          status: 1,
          location: 1,
          profilePhotoUrl: 1,
          createdAt: 1,
          lastLoginAt: 1,
          totalBookings: 1,
          totalSpent: 1,
          outstandingBalance: 1,
          averageOrder: 1,
          lastBookingAt: 1,
          lastPaymentAt: 1,
        },
      },
      {
        $sort: sort,
      },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: pagination.limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const total = result?.totalCount?.[0]?.count || 0;

    return {
      items: result?.items || [],
      pagination: {
        ...pagination,
        total,
        totalPages: Math.ceil(total / pagination.limit) || 1,
      },
    };
  }

  async getCustomerById(customerId) {
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      throw new AppError("Customer not found", 404);
    }

    const normalizedCustomerId = new mongoose.Types.ObjectId(customerId);
    const customer = await userRepository.findById(customerId, {
      select: "-password",
      lean: true,
    });

    if (!customer || customer.role !== ROLES.CUSTOMER) {
      throw new AppError("Customer not found", 404);
    }

    const [jobSummaryResult, paymentSummaryResult, latestPaidPayment, recentJobs] =
      await Promise.all([
        jobRepository.model.aggregate([
          {
            $match: {
              customer: normalizedCustomerId,
            },
          },
          {
            $group: {
              _id: null,
              totalBookings: { $sum: 1 },
              completedBookings: {
                $sum: {
                  $cond: [{ $in: ["$status", ["completed", "paid"]] }, 1, 0],
                },
              },
              activeBookings: {
                $sum: {
                  $cond: [{ $in: ["$status", ["new", "assigned", "in_progress"]] }, 1, 0],
                },
              },
              cancelledBookings: {
                $sum: {
                  $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0],
                },
              },
              lastBookingAt: { $max: "$createdAt" },
            },
          },
        ]),
        paymentRepository.model.aggregate([
          {
            $match: {
              customer: normalizedCustomerId,
            },
          },
          {
            $group: {
              _id: null,
              totalSpent: {
                $sum: {
                  $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0],
                },
              },
              paidOrders: {
                $sum: {
                  $cond: [{ $eq: ["$status", "paid"] }, 1, 0],
                },
              },
              outstandingBalance: {
                $sum: {
                  $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0],
                },
              },
              lastPaymentAt: {
                $max: {
                  $cond: [{ $eq: ["$status", "paid"] }, "$paidAt", null],
                },
              },
            },
          },
        ]),
        paymentRepository.findOne(
          {
            customer: normalizedCustomerId,
            status: "paid",
          },
          {
            sort: { paidAt: -1, createdAt: -1 },
            lean: true,
            select: "paymentMethod paidAt amount status currency",
          }
        ),
        jobRepository.model
          .find({ customer: normalizedCustomerId })
          .sort({ createdAt: -1 })
          .limit(25)
          .populate([
            {
              path: "customer",
              select: "name email phone",
            },
            {
              path: "assignedWorker",
              select: "name email phone workerStatus skills",
            },
          ])
          .lean(),
      ]);

    const jobSummary = jobSummaryResult[0] || {};
    const paymentSummary = paymentSummaryResult[0] || {};
    const averageOrder =
      paymentSummary.paidOrders > 0 ? paymentSummary.totalSpent / paymentSummary.paidOrders : 0;

    return {
      customer: {
        ...customer,
        totalBookings: jobSummary.totalBookings || 0,
        completedBookings: jobSummary.completedBookings || 0,
        activeBookings: jobSummary.activeBookings || 0,
        cancelledBookings: jobSummary.cancelledBookings || 0,
        totalSpent: paymentSummary.totalSpent || 0,
        outstandingBalance: paymentSummary.outstandingBalance || 0,
        averageOrder,
        lastBookingAt: jobSummary.lastBookingAt || null,
        lastPaymentAt: paymentSummary.lastPaymentAt || null,
        lastPaymentMethod: latestPaidPayment?.paymentMethod || "unknown",
      },
      summary: {
        totalBookings: jobSummary.totalBookings || 0,
        completedBookings: jobSummary.completedBookings || 0,
        activeBookings: jobSummary.activeBookings || 0,
        cancelledBookings: jobSummary.cancelledBookings || 0,
        totalSpent: paymentSummary.totalSpent || 0,
        outstandingBalance: paymentSummary.outstandingBalance || 0,
        averageOrder,
        lastPaymentAt: paymentSummary.lastPaymentAt || null,
        lastPaymentMethod: latestPaidPayment?.paymentMethod || "unknown",
      },
      recentBookings: await jobService.attachOperationalDetails(recentJobs),
    };
  }

  buildBookingListFilter(query = {}) {
    const filter = {};
    const normalizedSearch = String(query.search || "").trim();

    if (query.status) {
      filter.status = query.status;
    }

    if (query.urgency) {
      filter.urgency = jobService.normalizeUrgency(query.urgency);
    }

    if (normalizedSearch) {
      const searchPattern = { $regex: normalizedSearch, $options: "i" };
      filter.$or = [
        { title: searchPattern },
        { fullName: searchPattern },
        { email: searchPattern },
        { phoneNumber: searchPattern },
        { serviceType: searchPattern },
        { city: searchPattern },
        { zipCode: searchPattern },
      ];

      if (mongoose.Types.ObjectId.isValid(normalizedSearch)) {
        filter.$or.unshift({ _id: new mongoose.Types.ObjectId(normalizedSearch) });
      }
    }

    return filter;
  }

  async listBookings(query = {}) {
    const pagination = buildPagination(query);
    const filter = this.buildBookingListFilter(query);
    const result = await jobRepository.findManyWithRelations(filter, {
      ...pagination,
      sort: { createdAt: -1 },
    });

    return {
      ...result,
      items: await jobService.attachOperationalDetails(result.items),
    };
  }

  async getBookingById(adminUser, jobId) {
    return jobService.getJobById(adminUser, jobId);
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

  async getSettings(adminUserId) {
    const [platformSettings, paymentSettings, notificationSettings, legalDocs, adminProfile] =
      await Promise.all([
      contentRepository.findByKey("platform-settings"),
      contentRepository.findByKey("payment-settings"),
      contentRepository.findByKey("notification-settings"),
      contentRepository.findByKey("legal-docs"),
      this.getAdminProfile(adminUserId),
    ]);

    return {
      adminProfile,
      platformSettings: this.normalizePlatformSettings(platformSettings?.value),
      paymentSettings: this.normalizePaymentSettings(paymentSettings?.value),
      notificationSettings: this.normalizeNotificationSettings(notificationSettings?.value),
      legalDocs: this.normalizeLegalDocs(legalDocs?.value),
    };
  }

  async updateSettings(adminUser, payload = {}) {
    const updates = [];

    if (payload.platformSettings) {
      updates.push(
        contentRepository.updateOne(
          { key: "platform-settings" },
          {
            key: "platform-settings",
            title: "Platform Settings",
            value: this.normalizePlatformSettings(payload.platformSettings),
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
            value: this.normalizePaymentSettings(payload.paymentSettings),
            isPublic: false,
          },
          { upsert: true }
        )
      );
    }

    if (payload.notificationSettings) {
      updates.push(
        contentRepository.updateOne(
          { key: "notification-settings" },
          {
            key: "notification-settings",
            title: "Notification Settings",
            value: this.normalizeNotificationSettings(payload.notificationSettings),
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
            value: this.normalizeLegalDocs(payload.legalDocs),
            isPublic: false,
          },
          { upsert: true }
        )
      );
    }

    await Promise.all(updates);

    return this.getSettings(adminUser._id);
  }
}

module.exports = new AdminService();
