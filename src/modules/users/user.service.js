const AppError = require("../../errors/AppError");
const sanitizeUser = require("../../utils/sanitizeUser");
const userRepository = require("./user.repository");

class UserService {
  async getProfile(userId) {
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new AppError("User not found", 404);
    }

    return sanitizeUser(user);
  }

  async updateProfile(user, payload) {
    const update = {};

    if (payload.name !== undefined) update.name = payload.name;
    if (payload.phone !== undefined) update.phone = payload.phone;
    if (payload.age !== undefined) update.age = payload.age;
    if (payload.skills !== undefined) update.skills = payload.skills;
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
      startTime:
        payload.startTime ??
        payload.availability?.startTime ??
        user.availability?.startTime ??
        "",
      endTime:
        payload.endTime ??
        payload.availability?.endTime ??
        user.availability?.endTime ??
        "",
    };

    if (payload.email && payload.email !== user.email) {
      const existingUser = await userRepository.findByEmail(payload.email);
      if (existingUser && String(existingUser._id) !== String(user._id)) {
        throw new AppError("Email is already in use", 409);
      }
      update.email = payload.email.toLowerCase();
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
    if (String(requestingUser._id) !== String(userId) && requestingUser.role !== "admin") {
      throw new AppError("You are not allowed to access this profile", 403);
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    return sanitizeUser(user);
  }
}

module.exports = new UserService();
