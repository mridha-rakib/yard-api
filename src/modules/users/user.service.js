const Stripe = require("stripe");
const bcrypt = require("bcryptjs");
const env = require("../../config/env");
const AppError = require("../../errors/AppError");
const authSessionRepository = require("../auth/auth-session.repository");
const sanitizeUser = require("../../utils/sanitizeUser");
const { normalizeTimeValue } = require("../../utils/time");
const { ROLES } = require("../../constants/roles");
const { hasRole } = require("../../utils/user-roles");
const userRepository = require("./user.repository");
const { getWorkerPayoutReadiness } = require("../../utils/worker-payouts");

const STRIPE_CONNECT_BUSINESS_TYPES = [
  "individual",
  "company",
  "non_profit",
  "government_entity",
];

class UserService {
  getStripeClient() {
    if (!env.stripeSecretKey) {
      throw new AppError("Stripe is not configured", 500);
    }

    return new Stripe(env.stripeSecretKey);
  }

  getClientOrigin() {
    return new URL(env.clientUrl).origin;
  }

  resolveClientReturnUrl(rawUrl, fallbackPath) {
    const fallbackUrl = new URL(fallbackPath, env.clientUrl);

    if (!rawUrl) {
      return fallbackUrl.toString();
    }

    try {
      const resolvedUrl = rawUrl.startsWith("/")
        ? new URL(rawUrl, env.clientUrl)
        : new URL(rawUrl);

      if (resolvedUrl.origin !== this.getClientOrigin()) {
        return fallbackUrl.toString();
      }

      return resolvedUrl.toString();
    } catch {
      return fallbackUrl.toString();
    }
  }

  normalizeStripeConnectCountry(value = "") {
    const normalizedCountry = String(value || env.stripeConnectDefaultCountry || "US")
      .trim()
      .toUpperCase();

    if (!/^[A-Z]{2}$/.test(normalizedCountry)) {
      throw new AppError("Stripe payout country must be a valid two-letter country code", 400);
    }

    return normalizedCountry;
  }

  normalizeStripeConnectBusinessType(value = "") {
    const normalizedType = String(value || "individual").trim().toLowerCase();

    if (!STRIPE_CONNECT_BUSINESS_TYPES.includes(normalizedType)) {
      throw new AppError("Stripe payout business type is not supported", 400);
    }

    return normalizedType;
  }

  assertWorkerAccess(user) {
    if (!hasRole(user, ROLES.WORKER)) {
      throw new AppError("Only Heroes can manage payout accounts", 403);
    }
  }

  buildStripeAccountUpdate(account, existingUser = null) {
    const firstExternalAccount =
      account?.external_accounts?.data?.find((item) => item?.object === "bank_account") || null;
    const detailsSubmitted = Boolean(account?.details_submitted);
    const payoutsEnabled = Boolean(account?.payouts_enabled);

    return {
      stripeConnectedAccountId: String(account?.id || existingUser?.stripeConnectedAccountId || ""),
      stripeConnectCountry: String(
        account?.country || existingUser?.stripeConnectCountry || env.stripeConnectDefaultCountry
      ).toUpperCase(),
      stripeConnectBusinessType: this.normalizeStripeConnectBusinessType(
        account?.business_type || existingUser?.stripeConnectBusinessType || "individual"
      ),
      stripeConnectDefaultCurrency: String(
        account?.default_currency || existingUser?.stripeConnectDefaultCurrency || "usd"
      ).toLowerCase(),
      stripeConnectDetailsSubmitted: detailsSubmitted,
      stripeConnectChargesEnabled: Boolean(account?.charges_enabled),
      stripeConnectPayoutsEnabled: payoutsEnabled,
      stripeConnectRequirementsDue: Array.isArray(account?.requirements?.currently_due)
        ? account.requirements.currently_due
        : [],
      stripeConnectDisabledReason: String(
        account?.requirements?.disabled_reason || account?.disabled_reason || ""
      ).trim(),
      stripeConnectOnboardingCompletedAt:
        detailsSubmitted && payoutsEnabled
          ? existingUser?.stripeConnectOnboardingCompletedAt || new Date()
          : null,
      stripeConnectLastSyncedAt: new Date(),
      stripeExternalAccountId: String(firstExternalAccount?.id || ""),
      stripeExternalAccountBankName: String(firstExternalAccount?.bank_name || "").trim(),
      stripeExternalAccountLast4: String(firstExternalAccount?.last4 || "").trim(),
      stripeExternalAccountCurrency: String(firstExternalAccount?.currency || "").toLowerCase(),
    };
  }

  buildPayoutAccountResponse(user) {
    const payoutReadiness = getWorkerPayoutReadiness(user);

    return {
      connectedAccountId: user?.stripeConnectedAccountId || "",
      country: user?.stripeConnectCountry || env.stripeConnectDefaultCountry,
      businessType: user?.stripeConnectBusinessType || "individual",
      onboardingComplete: Boolean(user?.stripeConnectOnboardingCompletedAt),
      detailsSubmitted: Boolean(user?.stripeConnectDetailsSubmitted),
      payoutsEnabled: Boolean(user?.stripeConnectPayoutsEnabled),
      chargesEnabled: Boolean(user?.stripeConnectChargesEnabled),
      requirementsDue: Array.isArray(user?.stripeConnectRequirementsDue)
        ? user.stripeConnectRequirementsDue
        : [],
      disabledReason: user?.stripeConnectDisabledReason || "",
      lastSyncedAt: user?.stripeConnectLastSyncedAt || null,
      bankAccount: {
        id: user?.stripeExternalAccountId || "",
        bankName: user?.stripeExternalAccountBankName || "",
        last4: user?.stripeExternalAccountLast4 || "",
        currency: user?.stripeExternalAccountCurrency || "",
      },
      lastPayout: {
        id: user?.stripeLastPayoutId || "",
        status: user?.stripeLastPayoutStatus || "",
        failureCode: user?.stripeLastPayoutFailureCode || "",
        failureMessage: user?.stripeLastPayoutFailureMessage || "",
        arrivalDate: user?.stripeLastPayoutArrivalDate || null,
        updatedAt: user?.stripeLastPayoutUpdatedAt || null,
      },
      ...payoutReadiness,
    };
  }

  async syncStripeConnectedAccountById(accountId) {
    if (!accountId) {
      return null;
    }

    const [existingUser, account] = await Promise.all([
      userRepository.findByStripeConnectedAccountId(accountId),
      this.getStripeClient().accounts.retrieve(accountId, {
        expand: ["external_accounts"],
      }),
    ]);

    if (!existingUser) {
      return null;
    }

    return userRepository.updateById(
      existingUser._id,
      this.buildStripeAccountUpdate(account, existingUser)
    );
  }

  assertExistingConnectedAccountMatchesRequest(user, requestedCountry, requestedBusinessType) {
    if (!user?.stripeConnectedAccountId) {
      return;
    }

    const existingCountry = String(
      user.stripeConnectCountry || env.stripeConnectDefaultCountry || "US"
    ).toUpperCase();
    const existingBusinessType = this.normalizeStripeConnectBusinessType(
      user.stripeConnectBusinessType || "individual"
    );

    if (requestedCountry && requestedCountry !== existingCountry) {
      throw new AppError(
        `This Stripe account was already created for ${existingCountry}. Contact support to change payout country.`,
        409
      );
    }

    if (requestedBusinessType && requestedBusinessType !== existingBusinessType) {
      throw new AppError(
        `This Stripe account was already created as ${existingBusinessType}. Contact support to change business type.`,
        409
      );
    }
  }

  async ensureWorkerConnectedAccount(user, payload = {}) {
    const requestedCountry = payload.country
      ? this.normalizeStripeConnectCountry(payload.country)
      : "";
    const requestedBusinessType = payload.businessType
      ? this.normalizeStripeConnectBusinessType(payload.businessType)
      : "";

    this.assertExistingConnectedAccountMatchesRequest(
      user,
      requestedCountry,
      requestedBusinessType
    );

    if (user?.stripeConnectedAccountId) {
      return user.stripeConnectedAccountId;
    }

    const country = requestedCountry || this.normalizeStripeConnectCountry(user.stripeConnectCountry);
    const businessType =
      requestedBusinessType ||
      this.normalizeStripeConnectBusinessType(user.stripeConnectBusinessType);

    const account = await this.getStripeClient().accounts.create({
      type: "express",
      country,
      email: user.email,
      business_type: businessType,
      capabilities: {
        transfers: {
          requested: true,
        },
      },
      business_profile: {
        product_description: "Yard Heroes worker payouts",
      },
      metadata: {
        userId: String(user._id),
      },
    });

    await userRepository.updateById(user._id, {
      stripeConnectedAccountId: account.id,
      stripeConnectCountry: String(account.country || country).toUpperCase(),
      stripeConnectBusinessType: this.normalizeStripeConnectBusinessType(
        account.business_type || businessType
      ),
      stripeConnectDefaultCurrency: String(account.default_currency || "usd").toLowerCase(),
      stripeConnectLastSyncedAt: new Date(),
    });

    return account.id;
  }

  normalizePortfolioItems(items = []) {
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map((item, index) => ({
        id: String(item?.id || `portfolio-${index + 1}`).trim(),
        title: String(item?.title || "").trim(),
        description: String(item?.description || "").trim(),
        serviceType: String(item?.serviceType || "").trim(),
        imageUrl: String(item?.imageUrl || "").trim(),
        completedAt: item?.completedAt ? new Date(item.completedAt) : null,
      }))
      .filter((item) => item.imageUrl);
  }

  async getProfile(userId) {
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new AppError("User not found", 404);
    }

    return sanitizeUser(user);
  }

  async getWorkerPayoutAccountStatus(user) {
    this.assertWorkerAccess(user);

    let freshUser = await userRepository.findById(user._id);

    if (!freshUser) {
      throw new AppError("User not found", 404);
    }

    if (freshUser.stripeConnectedAccountId) {
      try {
        freshUser =
          (await this.syncStripeConnectedAccountById(freshUser.stripeConnectedAccountId)) ||
          freshUser;
      } catch (error) {
        // Preserve the saved state if Stripe is temporarily unavailable.
      }
    }

    return this.buildPayoutAccountResponse(freshUser);
  }

  async createWorkerPayoutOnboardingLink(user, payload = {}) {
    this.assertWorkerAccess(user);

    const freshUser = await userRepository.findById(user._id);

    if (!freshUser) {
      throw new AppError("User not found", 404);
    }

    const accountId = await this.ensureWorkerConnectedAccount(freshUser, payload);
    const refreshUrl = this.resolveClientReturnUrl(
      payload.refreshUrl,
      "/payment?stripeConnect=refresh"
    );
    const returnUrl = this.resolveClientReturnUrl(
      payload.returnUrl,
      "/payment?stripeConnect=return"
    );
    const accountLink = await this.getStripeClient().accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return {
      url: accountLink.url,
      account: await this.getWorkerPayoutAccountStatus(freshUser),
    };
  }

  async createWorkerPayoutDashboardLink(user) {
    this.assertWorkerAccess(user);

    const freshUser = await userRepository.findById(user._id);

    if (!freshUser) {
      throw new AppError("User not found", 404);
    }

    if (!freshUser.stripeConnectedAccountId) {
      throw new AppError("Complete Stripe onboarding before opening your payout dashboard", 409);
    }

    const loginLink = await this.getStripeClient().accounts.createLoginLink(
      freshUser.stripeConnectedAccountId
    );

    return {
      url: loginLink.url,
      account: await this.getWorkerPayoutAccountStatus(freshUser),
    };
  }

  async updateProfile(user, payload) {
    const update = {};
    const nextStartTime =
      payload.startTime ??
      payload.availability?.startTime ??
      user.availability?.startTime ??
      "";
    const nextEndTime =
      payload.endTime ??
      payload.availability?.endTime ??
      user.availability?.endTime ??
      "";

    if (payload.name !== undefined) update.name = payload.name;
    if (payload.phone !== undefined) update.phone = payload.phone;
    if (payload.age !== undefined) update.age = payload.age;
    if (payload.skills !== undefined) update.skills = payload.skills;
    if (payload.workerBio !== undefined) update.workerBio = payload.workerBio;
    if (payload.portfolioItems !== undefined) {
      update.portfolioItems = this.normalizePortfolioItems(payload.portfolioItems);
    }
    if (payload.profilePhotoUrl !== undefined) update.profilePhotoUrl = payload.profilePhotoUrl;
    if (payload.idDocumentUrl !== undefined) update.idDocumentUrl = payload.idDocumentUrl;

    update.location = {
      addressLine1:
        payload.addressLine1 ??
        payload.location?.addressLine1 ??
        user.location?.addressLine1 ??
        "",
      city: payload.city ?? payload.location?.city ?? user.location?.city ?? "",
      state: payload.state ?? payload.location?.state ?? user.location?.state ?? "",
      zipCode:
        payload.zipCode ?? payload.location?.zipCode ?? user.location?.zipCode ?? "",
    };

    update.availability = {
      label:
        payload.availabilityLabel ??
        payload.availability?.label ??
        user.availability?.label ??
        "",
      days:
        payload.availableDays ??
        payload.availability?.days ??
        user.availability?.days ??
        [],
      startTime: normalizeTimeValue(nextStartTime, "Start time"),
      endTime: normalizeTimeValue(nextEndTime, "End time"),
    };

    if (payload.email && payload.email !== user.email) {
      const existingUser = await userRepository.findByEmail(payload.email);
      if (existingUser && String(existingUser._id) !== String(user._id)) {
        throw new AppError("Email is already in use", 409);
      }
      update.email = payload.email.toLowerCase();

      if (!hasRole(user, ROLES.ADMIN)) {
        update.emailVerifiedAt = null;
      }
    }

    if (payload.phone && payload.phone !== user.phone) {
      const existingPhone = await userRepository.findByPhone(payload.phone);
      if (existingPhone && String(existingPhone._id) !== String(user._id)) {
        throw new AppError("Phone number is already in use", 409);
      }
    }

    const updatedUser = await userRepository.updateById(user._id, update);
    return sanitizeUser(updatedUser);
  }

  async getUserById(requestingUser, userId) {
    if (String(requestingUser._id) !== String(userId) && !hasRole(requestingUser, ROLES.ADMIN)) {
      throw new AppError("You are not allowed to access this profile", 403);
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    return sanitizeUser(user);
  }

  async changePassword(user, payload, sessionId = "") {
    const currentPassword = String(payload.currentPassword || "");
    const newPassword = String(payload.newPassword || "");

    if (!currentPassword || !newPassword) {
      throw new AppError("Current password and new password are required", 400);
    }

    if (newPassword.length < 8) {
      throw new AppError("New password must be at least 8 characters", 400);
    }

    const existingUser = await userRepository.findById(user._id);

    if (!existingUser) {
      throw new AppError("User not found", 404);
    }

    const passwordMatched = await bcrypt.compare(currentPassword, existingUser.password);

    if (!passwordMatched) {
      throw new AppError("Current password is incorrect", 401);
    }

    const nextPasswordMatchesCurrent = await bcrypt.compare(newPassword, existingUser.password);

    if (nextPasswordMatchesCurrent) {
      throw new AppError("New password must be different from the current password", 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await userRepository.updateById(user._id, {
      password: hashedPassword,
    });

    if (sessionId) {
      await authSessionRepository.updateMany(
        {
          user: user._id,
          isRevoked: false,
          _id: { $ne: sessionId },
        },
        {
          isRevoked: true,
          revokedAt: new Date(),
          revokeReason: "password_changed",
        }
      );
    }

    return { success: true };
  }
}

module.exports = new UserService();
