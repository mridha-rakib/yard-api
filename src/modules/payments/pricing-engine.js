const AppError = require("../../errors/AppError");

const roundMoney = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const roundMeasurement = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toPositiveNumber = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
};

const SERVICE_CATEGORIES = [
  {
    id: "yard",
    label: "Yard and Outdoor",
    services: [
      {
        id: "yard-storm-cleanup",
        title: "Storm Debris Cleanup",
        pricingType: "sqft",
        minimumPrice: 90,
        unitRate: 0.06,
      },
      {
        id: "yard-general-cleanup",
        title: "Yard Cleanup (General)",
        pricingType: "sqft",
        minimumPrice: 75,
        unitRate: 0.05,
      },
      {
        id: "yard-garden-bed-cleanup",
        title: "Garden Bed Cleanup",
        pricingType: "sqft",
        minimumPrice: 75,
        unitRate: 0.05,
      },
      {
        id: "yard-weed-removal",
        title: "Weed Removal",
        pricingType: "sqft",
        minimumPrice: 65,
        unitRate: 0.07,
      },
      {
        id: "yard-hedge-trimming",
        title: "Hedge Trimming",
        pricingType: "sqft",
        minimumPrice: 60,
        unitRate: 0.04,
      },
      {
        id: "home-patio-sweeping",
        title: "Patio and Deck Sweeping",
        pricingType: "sqft",
        minimumPrice: 60,
        unitRate: 0.05,
      },
      {
        id: "yard-lawn-mowing",
        title: "Lawn Mowing",
        pricingType: "sqft",
        minimumPrice: 40,
        unitRate: 0.032,
      },
      {
        id: "yard-snow-shoveling",
        title: "Snow Shoveling",
        pricingType: "sqft",
        minimumPrice: 50,
        unitRate: 0.05,
      },
      {
        id: "yard-leaf-cleanup",
        title: "Leaf Blowing and Cleanup",
        pricingType: "sqft",
        minimumPrice: 45,
        unitRate: 0.04,
      },
      {
        id: "yard-mulching",
        title: "Mulching",
        pricingType: "mulch",
        minimumPrice: 600,
        minimumYards: 5,
        defaultDepthIn: 3,
        unitRate: 120,
      },
      {
        id: "yard-bush-trimming",
        title: "Bush and Shrub Trimming",
        pricingType: "fixed",
        fixedPrice: 55,
      },
    ],
  },
  {
    id: "pet",
    label: "Pet and Property",
    services: [
      {
        id: "pet-waste-removal",
        title: "Dog Poop / Pet Waste Removal",
        pricingType: "sqft",
        minimumPrice: 50,
        unitRate: 0.06,
      },
      {
        id: "pet-yard-sanitizing",
        title: "Yard Sanitizing",
        pricingType: "fixed",
        fixedPrice: 40,
      },
      {
        id: "pet-litter-cleanup",
        title: "Litter Cleanup",
        pricingType: "fixed",
        fixedPrice: 40,
      },
    ],
  },
  {
    id: "vehicle",
    label: "Vehicle Services",
    services: [
      {
        id: "vehicle-gas-filling",
        title: "Gas Filling",
        pricingType: "fixed",
        fixedPrice: 25,
      },
      {
        id: "vehicle-washer-fluid",
        title: "Windshield Washer Fluid Refill",
        pricingType: "fixed",
        fixedPrice: 15,
      },
      {
        id: "vehicle-tire-air",
        title: "Tire Air Fill",
        pricingType: "fixed",
        fixedPrice: 10,
      },
      {
        id: "vehicle-exterior-wash",
        title: "Car Exterior Wash",
        pricingType: "fixed",
        fixedPrice: 50,
      },
      {
        id: "vehicle-interior-vacuuming",
        title: "Interior Vacuuming",
        pricingType: "fixed",
        fixedPrice: 40,
      },
    ],
  },
  {
    id: "home",
    label: "Home Exterior",
    services: [
      {
        id: "home-trash-bin-cleaning",
        title: "Trash Bin Cleaning",
        pricingType: "fixed",
        fixedPrice: 25,
      },
      {
        id: "home-pressure-washing",
        title: "Pressure Washing",
        pricingType: "fixed",
        fixedPrice: 120,
      },
      {
        id: "home-gutter-removal",
        title: "Gutter Debris Removal",
        pricingType: "fixed",
        fixedPrice: 120,
      },
      {
        id: "home-window-washing",
        title: "Window Washing",
        pricingType: "fixed",
        fixedPrice: 65,
      },
    ],
  },
];

const SERVICE_DEFINITIONS = SERVICE_CATEGORIES.flatMap((category) =>
  category.services.map((service) => ({
    ...service,
    categoryId: category.id,
    categoryLabel: category.label,
  }))
);

const findServiceDefinition = (identifier = "") => {
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();

  if (!normalizedIdentifier) {
    return null;
  }

  return (
    SERVICE_DEFINITIONS.find(
      (service) =>
        service.id.toLowerCase() === normalizedIdentifier ||
        service.title.toLowerCase() === normalizedIdentifier
    ) || null
  );
};

const requireSqft = (service, sqftValue) => {
  if (sqftValue > 0) {
    return sqftValue;
  }

  throw new AppError(
    `${service.title} requires a square-foot measurement to calculate the final price`,
    400
  );
};

const calculateFixedPriceQuote = (service) => {
  const fixedPrice = roundMoney(service.fixedPrice);

  return {
    serviceId: service.id,
    serviceTitle: service.title,
    categoryId: service.categoryId,
    categoryLabel: service.categoryLabel,
    pricingType: "fixed",
    input: {},
    minimumPrice: fixedPrice,
    calculatedPrice: fixedPrice,
    finalPrice: fixedPrice,
    fixedPrice,
    summary: `Fixed price of $${fixedPrice.toFixed(2)}`,
  };
};

const calculateSqftQuote = (service, input = {}) => {
  const sqft = requireSqft(service, toPositiveNumber(input.sqft));
  const calculatedPrice = roundMoney(sqft * service.unitRate);
  const finalPrice = roundMoney(Math.max(service.minimumPrice, calculatedPrice));

  return {
    serviceId: service.id,
    serviceTitle: service.title,
    categoryId: service.categoryId,
    categoryLabel: service.categoryLabel,
    pricingType: "sqft",
    input: {
      sqft,
    },
    minimumPrice: roundMoney(service.minimumPrice),
    unitRate: service.unitRate,
    calculatedPrice,
    finalPrice,
    summary: `Higher of $${roundMoney(service.minimumPrice).toFixed(2)} minimum or ${sqft} sq ft x $${service.unitRate}/sq ft`,
  };
};

const calculateMulchQuote = (service, input = {}) => {
  const sqft = toPositiveNumber(input.sqft);
  const depthIn = toPositiveNumber(input.depthIn) || service.defaultDepthIn || 3;
  const depthFt = roundMeasurement(depthIn / 12);
  const cubicFt = roundMeasurement(sqft * depthFt);
  const rawYards = roundMeasurement(cubicFt / 27);
  const chargeableYards = roundMeasurement(
    Math.max(rawYards || 0, Number(service.minimumYards || 5))
  );
  const calculatedPrice = roundMoney(chargeableYards * Number(service.unitRate || 120));
  const minimumPrice = roundMoney(
    Number(service.minimumYards || 5) * Number(service.unitRate || 120)
  );

  return {
    serviceId: service.id,
    serviceTitle: service.title,
    categoryId: service.categoryId,
    categoryLabel: service.categoryLabel,
    pricingType: "mulch",
    input: {
      sqft,
      depthIn,
    },
    measurement: {
      depthFt,
      cubicFt,
      rawYards,
      chargeableYards,
    },
    minimumPrice,
    minimumYards: Number(service.minimumYards || 5),
    unitRate: Number(service.unitRate || 120),
    calculatedPrice,
    finalPrice: calculatedPrice,
    summary:
      sqft > 0
        ? `${sqft} sq ft at ${depthIn}" depth = ${chargeableYards} yards charged`
        : `Defaulted to the ${Number(service.minimumYards || 5)} yard minimum`,
  };
};

const calculateQuote = (identifier, input = {}) => {
  const service = findServiceDefinition(identifier);

  if (!service) {
    throw new AppError("Selected service is not supported by the pricing engine", 400);
  }

  if (service.pricingType === "fixed") {
    return calculateFixedPriceQuote(service);
  }

  if (service.pricingType === "mulch") {
    return calculateMulchQuote(service, input);
  }

  return calculateSqftQuote(service, input);
};

module.exports = {
  SERVICE_CATEGORIES,
  SERVICE_DEFINITIONS,
  findServiceDefinition,
  calculateQuote,
};
