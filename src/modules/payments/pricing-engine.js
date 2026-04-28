const AppError = require("../../errors/AppError");
const contentRepository = require("../content/content.repository");

const roundMoney = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const roundMeasurement = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toPositiveNumber = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
};

const PRICING_CONFIG_KEY = "pricing-engine";

const DEFAULT_PRICING_CONFIG = {
  bundlingEnabled: false,
  defaultBundleDiscountPercent: 0,
};

const SERVICE_CATEGORIES = [
  {
    id: "yard",
    label: "Yard and Outdoor",
    bundleEligible: true,
    services: [
      {
        id: "yard-storm-cleanup",
        title: "Storm Debris Cleanup",
        pricingType: "sqft",
        minimumPrice: 90,
        unitRate: 0.06,
        bundleEligible: true,
      },
      {
        id: "yard-general-cleanup",
        title: "Yard Cleanup (General)",
        pricingType: "sqft",
        minimumPrice: 75,
        unitRate: 0.05,
        bundleEligible: true,
      },
      {
        id: "yard-garden-bed-cleanup",
        title: "Garden Bed Cleanup",
        pricingType: "sqft",
        minimumPrice: 75,
        unitRate: 0.05,
        bundleEligible: true,
      },
      {
        id: "yard-weed-removal",
        title: "Weed Removal",
        pricingType: "sqft",
        minimumPrice: 65,
        unitRate: 0.07,
        bundleEligible: true,
      },
      {
        id: "yard-hedge-trimming",
        title: "Hedge Trimming",
        pricingType: "sqft",
        minimumPrice: 60,
        unitRate: 0.04,
        bundleEligible: true,
      },
      {
        id: "home-patio-sweeping",
        title: "Patio and Deck Sweeping",
        pricingType: "sqft",
        minimumPrice: 60,
        unitRate: 0.05,
        bundleEligible: true,
      },
      {
        id: "yard-lawn-mowing",
        title: "Lawn Mowing",
        pricingType: "sqft",
        minimumPrice: 40,
        unitRate: 0.032,
        bundleEligible: true,
      },
      {
        id: "yard-snow-shoveling",
        title: "Snow Shoveling",
        pricingType: "sqft",
        minimumPrice: 50,
        unitRate: 0.05,
        bundleEligible: true,
      },
      {
        id: "yard-leaf-cleanup",
        title: "Leaf Blowing and Cleanup",
        pricingType: "sqft",
        minimumPrice: 45,
        unitRate: 0.04,
        bundleEligible: true,
      },
      {
        id: "yard-mulching",
        title: "Mulching",
        pricingType: "mulch",
        minimumPrice: 600,
        minimumYards: 5,
        defaultDepthIn: 3,
        unitRate: 120,
        bundleEligible: true,
      },
      {
        id: "yard-bush-trimming",
        title: "Bush and Shrub Trimming",
        pricingType: "fixed",
        fixedPrice: 55,
        bundleEligible: true,
      },
    ],
  },
  {
    id: "pet",
    label: "Pet and Property",
    bundleEligible: true,
    services: [
      {
        id: "pet-waste-removal",
        title: "Dog Poop / Pet Waste Removal",
        pricingType: "sqft",
        minimumPrice: 50,
        unitRate: 0.06,
        bundleEligible: true,
      },
      {
        id: "pet-yard-sanitizing",
        title: "Yard Sanitizing",
        pricingType: "fixed",
        fixedPrice: 40,
        bundleEligible: true,
      },
      {
        id: "pet-litter-cleanup",
        title: "Litter Cleanup",
        pricingType: "fixed",
        fixedPrice: 40,
        bundleEligible: true,
      },
    ],
  },
  {
    id: "vehicle",
    label: "Vehicle Services",
    bundleEligible: false,
    services: [
      {
        id: "test-live-payment",
        title: "Live Payment Test Job",
        pricingType: "fixed",
        fixedPrice: 2,
        bundleEligible: false,
      },
      {
        id: "vehicle-gas-filling",
        title: "Gas Filling",
        pricingType: "fixed",
        fixedPrice: 25,
        bundleEligible: true,
      },
      {
        id: "vehicle-washer-fluid",
        title: "Windshield Washer Fluid Refill",
        pricingType: "fixed",
        fixedPrice: 15,
        bundleEligible: true,
      },
      {
        id: "vehicle-tire-air",
        title: "Tire Air Fill",
        pricingType: "fixed",
        fixedPrice: 10,
        bundleEligible: true,
      },
      {
        id: "vehicle-exterior-wash",
        title: "Car Exterior Wash",
        pricingType: "fixed",
        fixedPrice: 50,
        bundleEligible: true,
      },
      {
        id: "vehicle-interior-vacuuming",
        title: "Interior Vacuuming",
        pricingType: "fixed",
        fixedPrice: 40,
        bundleEligible: true,
      },
    ],
  },
  {
    id: "home",
    label: "Home Exterior",
    bundleEligible: true,
    services: [
      {
        id: "home-trash-bin-cleaning",
        title: "Trash Bin Cleaning",
        pricingType: "fixed",
        fixedPrice: 25,
        bundleEligible: true,
      },
      {
        id: "home-pressure-washing",
        title: "Pressure Washing",
        pricingType: "fixed",
        fixedPrice: 120,
        bundleEligible: true,
      },
      {
        id: "home-gutter-removal",
        title: "Gutter Debris Removal",
        pricingType: "fixed",
        fixedPrice: 120,
        bundleEligible: true,
      },
      {
        id: "home-window-washing",
        title: "Window Washing",
        pricingType: "fixed",
        fixedPrice: 65,
        bundleEligible: true,
      },
    ],
  },
];

const DEFAULT_SERVICE_IDS = new Set(
  SERVICE_CATEGORIES.flatMap((category) => category.services.map((service) => service.id))
);

const slugify = (value = "service") => {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "service";
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : fallback;
};

const normalizePricingType = (value = "fixed") => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return ["fixed", "sqft", "mulch"].includes(normalizedValue) ? normalizedValue : "fixed";
};

const normalizeService = (service = {}, categoryId = "", index = 0) => {
  const title = String(service.title || `Service ${index + 1}`).trim();
  const pricingType = normalizePricingType(service.pricingType);
  const normalizedService = {
    id: slugify(service.id || `${categoryId}-${title}`),
    title,
    pricingType,
    isActive: service.isActive !== false,
    isDefaultService:
      service.isDefaultService !== undefined
        ? Boolean(service.isDefaultService)
        : DEFAULT_SERVICE_IDS.has(slugify(service.id || `${categoryId}-${title}`)),
    bundleEligible: Boolean(service.bundleEligible),
    bundleGroupIds: Array.isArray(service.bundleGroupIds)
      ? service.bundleGroupIds.map((value) => slugify(value)).filter(Boolean)
      : [],
  };

  if (pricingType === "fixed") {
    normalizedService.fixedPrice = roundMoney(toNonNegativeNumber(service.fixedPrice));
    normalizedService.minimumPrice = normalizedService.fixedPrice;
  } else if (pricingType === "mulch") {
    normalizedService.minimumYards = toNonNegativeNumber(service.minimumYards, 5) || 5;
    normalizedService.defaultDepthIn = toNonNegativeNumber(service.defaultDepthIn, 3) || 3;
    normalizedService.unitRate = roundMoney(toNonNegativeNumber(service.unitRate, 120) || 120);
    normalizedService.minimumPrice = roundMoney(
      normalizedService.minimumYards * normalizedService.unitRate
    );
  } else {
    normalizedService.minimumPrice = roundMoney(toNonNegativeNumber(service.minimumPrice));
    normalizedService.unitRate = toNonNegativeNumber(service.unitRate);
  }

  return normalizedService;
};

const normalizeCategory = (category = {}, index = 0) => {
  const label = String(category.label || category.title || `Service Group ${index + 1}`).trim();
  const id = slugify(category.id || label);
  const hasBundleDiscountOverride =
    category.bundleDiscountPercent !== undefined &&
    category.bundleDiscountPercent !== null &&
    category.bundleDiscountPercent !== "";

  return {
    id,
    label,
    title: String(category.title || label).trim(),
    subtitle: String(category.subtitle || "").trim(),
    bundleEligible: Boolean(category.bundleEligible),
    bundleDiscountPercent: hasBundleDiscountOverride
      ? Math.min(100, toNonNegativeNumber(category.bundleDiscountPercent))
      : null,
    services: (Array.isArray(category.services) ? category.services : []).map((service, serviceIndex) =>
      normalizeService(service, id, serviceIndex)
    ),
  };
};

const ensureUniqueServiceIds = (categories = []) => {
  const usedIds = new Set();

  return categories.map((category) => ({
    ...category,
    services: category.services.map((service) => {
      let nextId = service.id;
      let suffix = 2;

      while (usedIds.has(nextId)) {
        nextId = `${service.id}-${suffix}`;
        suffix += 1;
      }

      usedIds.add(nextId);
      return { ...service, id: nextId };
    }),
  }));
};

const normalizePricingConfig = (config = {}) => {
  const hasProvidedCategories = Array.isArray(config)
    ? config.length > 0
    : Array.isArray(config.categories);
  const rawCategories = hasProvidedCategories
    ? Array.isArray(config)
      ? config
      : config.categories
    : SERVICE_CATEGORIES;
  const categories = ensureUniqueServiceIds(rawCategories.map(normalizeCategory));

  return {
    bundlingEnabled: Boolean(config.bundlingEnabled ?? DEFAULT_PRICING_CONFIG.bundlingEnabled),
    defaultBundleDiscountPercent: Math.min(
      100,
      toNonNegativeNumber(
        config.defaultBundleDiscountPercent,
        DEFAULT_PRICING_CONFIG.defaultBundleDiscountPercent
      )
    ),
    categories,
  };
};

const getBundleDiscountPercent = (config = {}, selectedServices = []) => {
  const globalDiscountPercent = Math.min(
    100,
    Math.max(0, Number(config.defaultBundleDiscountPercent || 0))
  );
  const categoryIds = [...new Set(selectedServices.map((service) => service.categoryId))];

  if (categoryIds.length !== 1) {
    return globalDiscountPercent;
  }

  const category = (config.categories || []).find((entry) => entry.id === categoryIds[0]);
  const categoryDiscountPercent = category?.bundleDiscountPercent;

  if (categoryDiscountPercent === null || categoryDiscountPercent === undefined) {
    return globalDiscountPercent;
  }

  return Math.min(100, Math.max(0, Number(categoryDiscountPercent || 0)));
};

const buildServiceDefinitions = (categories = SERVICE_CATEGORIES, options = {}) =>
  categories.flatMap((category) =>
  category.services.map((service) => ({
    ...service,
    categoryId: category.id,
    categoryLabel: category.label,
    categoryTitle: category.title || category.label,
    categoryBundleEligible: Boolean(category.bundleEligible),
  }))
).filter((service) => options.includeInactive || service.isActive !== false);

const SERVICE_DEFINITIONS = buildServiceDefinitions(SERVICE_CATEGORIES, {
  includeInactive: true,
});

const getPricingConfig = async () => {
  const storedConfig = await contentRepository.findByKey(PRICING_CONFIG_KEY);
  return normalizePricingConfig(storedConfig?.value || {});
};

const savePricingConfig = async (payload = {}) => {
  const config = normalizePricingConfig(payload);

  await contentRepository.updateOne(
    { key: PRICING_CONFIG_KEY },
    {
      key: PRICING_CONFIG_KEY,
      title: "Pricing Engine",
      value: config,
      isPublic: false,
    },
    { upsert: true }
  );

  return config;
};

const getServiceDefinitions = async (options = {}) => {
  const config = await getPricingConfig();
  return buildServiceDefinitions(config.categories, options);
};

const findServiceDefinition = async (identifier = "", options = {}) => {
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();

  if (!normalizedIdentifier) {
    return null;
  }

  const serviceDefinitions = await getServiceDefinitions(options);

  return (
    serviceDefinitions.find(
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

const calculateQuote = async (identifier, input = {}) => {
  const service = await findServiceDefinition(identifier);

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

const addBundleServiceInput = (inputMap, identifier, input = {}) => {
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();

  if (!normalizedIdentifier || !input || typeof input !== "object") {
    return;
  }

  inputMap.set(normalizedIdentifier, input);
};

const getBundleServiceInputMap = (input = {}) => {
  const inputMap = new Map();

  if (!input || typeof input !== "object") {
    return inputMap;
  }

  const serviceInputs =
    input.serviceInputs && typeof input.serviceInputs === "object" ? input.serviceInputs : {};

  Object.entries(serviceInputs).forEach(([identifier, serviceInput]) => {
    addBundleServiceInput(inputMap, identifier, serviceInput);
  });

  const arrayInputs = [
    ...(Array.isArray(input.services) ? input.services : []),
    ...(Array.isArray(input.serviceMeasurements) ? input.serviceMeasurements : []),
    ...(Array.isArray(input.measurements) ? input.measurements : []),
  ];

  arrayInputs.forEach((serviceInput) => {
    if (!serviceInput || typeof serviceInput !== "object") {
      return;
    }

    addBundleServiceInput(
      inputMap,
      serviceInput.serviceId || serviceInput.id || serviceInput.serviceTitle || serviceInput.title,
      serviceInput
    );
  });

  return inputMap;
};

const getBundleServiceInput = (service, bundleInput = {}, inputMap = null) => {
  const serviceInputMap = inputMap || getBundleServiceInputMap(bundleInput);
  const serviceSpecificInput =
    serviceInputMap.get(String(service.id || "").toLowerCase()) ||
    serviceInputMap.get(String(service.title || "").toLowerCase());

  if (serviceSpecificInput) {
    return serviceSpecificInput;
  }

  return bundleInput && typeof bundleInput === "object" ? bundleInput : {};
};

const calculateBundleQuote = async (identifiers = [], input = {}) => {
  const requestedIdentifiers = Array.isArray(identifiers)
    ? identifiers.map((identifier) => String(identifier || "").trim()).filter(Boolean)
    : [];
  const uniqueIdentifiers = [...new Set(requestedIdentifiers)];

  if (uniqueIdentifiers.length < 2) {
    throw new AppError("Select at least two services to create a bundle", 400);
  }

  const config = await getPricingConfig();

  if (!config.bundlingEnabled) {
    throw new AppError("Service bundling is not enabled", 400);
  }

  const serviceDefinitions = buildServiceDefinitions(config.categories);
  const selectedServices = uniqueIdentifiers.map((identifier) => {
    const normalizedIdentifier = identifier.toLowerCase();
    const service = serviceDefinitions.find(
      (entry) =>
        entry.id.toLowerCase() === normalizedIdentifier ||
        entry.title.toLowerCase() === normalizedIdentifier
    );

    if (!service) {
      throw new AppError("One or more bundle services are not available", 400);
    }

    if (!service.bundleEligible || !service.categoryBundleEligible) {
      throw new AppError(`${service.title} is not eligible for bundling`, 400);
    }

    return service;
  });
  const serviceInputMap = getBundleServiceInputMap(input);
  const quotes = selectedServices.map((service) => {
    const serviceInput = getBundleServiceInput(service, input, serviceInputMap);

    if (service.pricingType === "fixed") {
      return calculateFixedPriceQuote(service);
    }

    if (service.pricingType === "mulch") {
      return calculateMulchQuote(service, serviceInput);
    }

    return calculateSqftQuote(service, serviceInput);
  });
  const subtotalBeforeDiscount = roundMoney(
    quotes.reduce((sum, quote) => sum + Number(quote.finalPrice || 0), 0)
  );
  const discountPercent = getBundleDiscountPercent(config, selectedServices);
  const discountAmount = roundMoney((subtotalBeforeDiscount * discountPercent) / 100);
  const finalPrice = roundMoney(Math.max(0, subtotalBeforeDiscount - discountAmount));

  return {
    serviceId: `bundle-${selectedServices.map((service) => service.id).join("-")}`,
    serviceTitle: `Bundle: ${selectedServices.map((service) => service.title).join(", ")}`,
    pricingType: "bundle",
    input: {
      serviceInputs: Object.fromEntries(
        quotes.map((quote) => [quote.serviceId, quote.input || {}])
      ),
    },
    services: quotes,
    bundleServiceIds: selectedServices.map((service) => service.id),
    bundleServiceTitles: selectedServices.map((service) => service.title),
    discountPercent,
    discountAmount,
    subtotalBeforeDiscount,
    calculatedPrice: subtotalBeforeDiscount,
    finalPrice,
    summary:
      discountPercent > 0
        ? `${selectedServices.length} bundled services with ${discountPercent}% bundle discount`
        : `${selectedServices.length} bundled services`,
  };
};

module.exports = {
  SERVICE_CATEGORIES,
  SERVICE_DEFINITIONS,
  DEFAULT_SERVICE_IDS,
  PRICING_CONFIG_KEY,
  normalizePricingConfig,
  getPricingConfig,
  savePricingConfig,
  getServiceDefinitions,
  findServiceDefinition,
  calculateQuote,
  calculateBundleQuote,
};
