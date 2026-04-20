const bcrypt = require("bcryptjs");
const AppError = require("../../errors/AppError");
const authSessionRepository = require("../auth/auth-session.repository");
const sanitizeUser = require("../../utils/sanitizeUser");
const { normalizeTimeValue } = require("../../utils/time");
const { ROLES } = require("../../constants/roles");
const { hasRole } = require("../../utils/user-roles");
const userRepository = require("./user.repository");

class UserService {
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
