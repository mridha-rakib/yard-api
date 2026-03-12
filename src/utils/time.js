const AppError = require("../errors/AppError");

const EMPTY_TIME = "";

const toTwoDigits = (value) => String(value).padStart(2, "0");

const buildInvalidTimeError = (fieldName) =>
  new AppError(
    `${fieldName} must be a valid time in HH:mm or h:mm AM/PM format`,
    400
  );

const normalizeTwentyFourHourTime = (hoursText, minutesText, fieldName) => {
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw buildInvalidTimeError(fieldName);
  }

  return `${toTwoDigits(hours)}:${toTwoDigits(minutes)}`;
};

const normalizeTwelveHourTime = (hoursText, minutesText = "00", meridiem, fieldName) => {
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 1 ||
    hours > 12 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw buildInvalidTimeError(fieldName);
  }

  const normalizedMeridiem = String(meridiem).toUpperCase();
  const twentyFourHourValue =
    normalizedMeridiem === "PM" ? (hours % 12) + 12 : hours % 12;

  return `${toTwoDigits(twentyFourHourValue)}:${toTwoDigits(minutes)}`;
};

const normalizeTimeValue = (value, fieldName = "Time") => {
  if (value === undefined || value === null) {
    return EMPTY_TIME;
  }

  const trimmedValue = String(value).trim();

  if (!trimmedValue) {
    return EMPTY_TIME;
  }

  const twentyFourHourMatch = trimmedValue.match(/^(\d{1,2}):(\d{2})$/);

  if (twentyFourHourMatch) {
    return normalizeTwentyFourHourTime(
      twentyFourHourMatch[1],
      twentyFourHourMatch[2],
      fieldName
    );
  }

  const twelveHourMatch = trimmedValue.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);

  if (twelveHourMatch) {
    return normalizeTwelveHourTime(
      twelveHourMatch[1],
      twelveHourMatch[2] || "00",
      twelveHourMatch[3],
      fieldName
    );
  }

  throw buildInvalidTimeError(fieldName);
};

module.exports = {
  normalizeTimeValue,
};
