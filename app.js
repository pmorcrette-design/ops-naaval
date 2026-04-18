function normalizeApiBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

const API_BASE_CANDIDATES = (() => {
  const candidates = [];
  const configuredApiBase = normalizeApiBaseUrl(window.NAAVAL_API_BASE_URL);

  if (configuredApiBase) {
    candidates.push(configuredApiBase);
  }

  if (window.location.protocol.startsWith("http")) {
    candidates.push(normalizeApiBaseUrl(window.location.origin));
  }

  candidates.push("http://localhost:3001");
  return [...new Set(candidates.filter(Boolean))];
})();

const state = {
  activeView: "orders",
  apiAvailable: false,
  apiBaseUrl: "",
  dataMode: "Loading",
  solverMode: "Loading",
  selectedDate: (() => {
    const today = new Date();
    const year = String(today.getFullYear());
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  })(),
  lastImportSummary: null,
  pricingConfig: null,
  pricingDraft: null,
  graphhopperUsage: {
    enabled: false,
    remaining: null,
    limit: null,
    resetSeconds: null,
    updatedAt: null
  },
  graphhopperUsageLoading: false,
  optimizerSetup: buildDefaultOptimizerSetup(),
  optimizerSpreadsheetHeaders: buildDefaultOptimizerSpreadsheetHeaders(),
  optimizerTimeField: null,
  quoteContext: null,
  orders: [],
  drivers: [],
  carrierCompanies: [],
  opsUsers: [],
  accountCustomers: [],
  customers: [],
  quotes: [],
  recurringRoutes: [],
  planningJobs: [],
  inboxMessages: [],
  routeGeometryByRouteId: {},
  routeGeometryLoadingIds: [],
  shifts: [],
  hubs: [],
  routes: [],
  selectedOrderId: null,
  selectedDriverId: null,
  selectedCustomerId: null,
  selectedRecurringRouteId: null,
  selectedOpsUserId: null,
  editingOpsUserId: null,
  selectedOptimizerRouteId: null,
  selectedPlanningJobId: null,
  selectedComparePlanIds: [],
  selectedPlanningOrderIds: [],
  selectedAdminPricingAlgo: null,
  selectedPricingAlgo: "basic",
  activeOptimizerStage: "history",
  selectedInboxAudience: "customers",
  selectedInboxThreadId: null,
  isAuthenticated: false,
  currentUser: null,
  pendingCarrierCompanyId: null,
  orderAssignmentFilters: {},
  adminSection: "pricing",
  toastTimer: null
};

let localDb = null;
let googleIdentityRetryTimer = null;
let opsLiveRefreshTimer = null;

function todayAt(hours, minutes) {
  const value = new Date();
  value.setHours(hours, minutes, 0, 0);
  return value.toISOString();
}

function buildDefaultPricingConfig() {
  return {
    currency: "EUR",
    basic: {
      distanceRatePerKm: 0.5,
      sizeBasePrices: {
        S: 9.8,
        M: 14.4,
        L: 18.91,
        XL: 24.6,
        XXL: 29.8
      }
    },
    pallet: {
      pricePerPallet: 35,
      vehicleThresholds: {
        van_3m3: 2,
        van_5m3: 4,
        van_10m3: 6,
        van_20m3: 8
      }
    },
    hours: {
      minimumHours: 3,
      includedKm: 150,
      vehicleHourlyRates: {
        bike: 16.5,
        scooter: 19.5,
        car: 23,
        van_3m3: 28.75,
        van_5m3: 31.62,
        van_10m3: 36.36,
        van_15m3: 41.84,
        van_20m3: 48.11
      }
    },
    drops: {
      minimumDrops: 10,
      includedKm: 100,
      vehicleDropRates: {
        car: 8.5,
        van_3m3: 11,
        van_5m3: 13.25,
        van_10m3: 16.2,
        van_15m3: 18.9,
        van_20m3: 22.4
      }
    }
  };
}

function buildDefaultPricingDraft() {
  return {
    basic: {
      parcelSize: "L",
      distanceKm: 5
    },
    pallet: {
      palletCount: 3,
      roundTrips: 1
    },
    hours: {
      hours: 3,
      vehicleType: "van_3m3"
    },
    drops: {
      drops: 8,
      vehicleType: "van_3m3"
    }
  };
}

function buildDefaultOptimizerSetup() {
  return {
    name: "TEST 1",
    customer: "MERCHANT_DEMO",
    trucks: 10,
    startTime: "09:00",
    endTime: "23:00",
    handlingMinutes: 10,
    pickupLandingMinutes: 15,
    pickupAddress: "12 Rue du Depot, 75011 Paris",
    parcelSize: "S",
    formula: "completion_time"
  };
}

function buildDefaultOptimizerSpreadsheetHeaders() {
  return {
    lastName: "Name",
    firstName: "First Name",
    companyName: "Company Name",
    streetName: "Street Name",
    postCode: "Post Code",
    city: "City",
    country: "Country",
    phone: "Phone",
    mail: "Mail",
    parcelSize: "Parcel Size",
    comment: "Comment"
  };
}

const ADMIN_PRICING_ALGOS = [
  {
    id: "basic",
    tag: "Basic Algo",
    title: "Basic Algo",
    description: "Distance-based pricing with base prices by parcel size."
  },
  {
    id: "pallet",
    tag: "Palette",
    title: "Palette",
    description: "Pallet pricing and recommended capacity thresholds by vehicle."
  },
  {
    id: "hours",
    tag: "By Hours",
    title: "By Hours",
    description: "Hourly pricing with minimum billing and included distance."
  },
  {
    id: "drops",
    tag: "By Drop",
    title: "By Drop",
    description: "Per-drop pricing with a minimum billed route volume."
  }
];

const AUTH_STORAGE_KEY = "naaval.ops.session";
const RECURRING_DAY_OPTIONS = [
  { code: "mon", short: "L", label: "Lundi" },
  { code: "tue", short: "M", label: "Mardi" },
  { code: "wed", short: "M", label: "Mercredi" },
  { code: "thu", short: "J", label: "Jeudi" },
  { code: "fri", short: "V", label: "Vendredi" },
  { code: "sat", short: "S", label: "Samedi" },
  { code: "sun", short: "D", label: "Dimanche" }
];

function getOpsConfigValue(key) {
  const configured = typeof window[key] === "string" ? window[key].trim() : window[key];
  if (typeof configured === "string" && configured) {
    return configured;
  }

  if (typeof configured === "boolean") {
    return configured;
  }

  try {
    const stored = window.localStorage.getItem(key);
    return stored ? stored.trim() : "";
  } catch (_error) {
    return "";
  }
}

function getBooleanOpsConfigValue(key) {
  const value = getOpsConfigValue(key);
  return value === true || String(value).toLowerCase() === "true";
}

function buildFallbackDb() {
  return {
    hubs: [
      {
        id: "hub_paris_central",
        label: "Paris Central Hub",
        city: "Paris",
        coordinates: { lat: 48.8619, lon: 2.3765 }
      }
    ],
    carrierCompanies: [
      {
        id: "carrier_naaval_partners",
        name: "Naaval Partners",
        legalName: "Naaval Partners SAS",
        email: "ops@naavalpartners.com",
        phone: "+33100000000",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    drivers: [
      {
        id: "driver_amina",
        name: "Amina Laurent",
        firstName: "Amina",
        lastName: "Laurent",
        email: "amina@naavalpartners.com",
        phone: "+33600000001",
        skills: ["fragile"],
        vehicleType: "van_3m3",
        carrierCompanyId: "carrier_naaval_partners",
        vehiclePhotoUrls: [],
        status: "active"
      },
      {
        id: "driver_noah",
        name: "Noah Bernard",
        firstName: "Noah",
        lastName: "Bernard",
        email: "noah@naavalpartners.com",
        phone: "+33600000002",
        skills: ["cold_chain", "bike"],
        vehicleType: "bike",
        carrierCompanyId: "carrier_naaval_partners",
        vehiclePhotoUrls: [],
        status: "active"
      }
    ],
    opsUsers: [
      {
        id: "ops_user_pierre",
        firstName: "Pierre",
        lastName: "Ops",
        email: "pierre@naaval.app",
        role: "ops_admin",
        team: "Operations",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    customers: [
      {
        id: "customer_naaval_retail",
        companyName: "Naaval Retail",
        headquartersAddress: "18 Rue du Commerce, 75015 Paris",
        vatNumber: "FR12345678901",
        companyPhone: "+33199999999",
        companyEmail: "finance@naavalretail.com",
        contactFirstName: "Claire",
        contactLastName: "Martin",
        contactPhone: "+33699999999",
        contactEmail: "claire@naavalretail.com",
        revenueRange: "2m-10m",
        companySize: "mid_market",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    quotes: [],
    recurringRoutes: [],
    inboxMessages: [],
    graphhopperUsage: {
      enabled: false,
      remaining: 5000,
      limit: 5000,
      resetSeconds: null,
      updatedAt: new Date().toISOString(),
      source: "prototype"
    },
    shifts: [
      {
        id: "shift_amina_am",
        driverId: "driver_amina",
        vehicleId: "vehicle_van_1",
        vehicleTypeId: "vehicletype_van",
        startAt: todayAt(8, 0),
        endAt: todayAt(16, 0),
        startCoordinates: { lat: 48.8619, lon: 2.3765 },
        endCoordinates: { lat: 48.8619, lon: 2.3765 },
        skills: ["fragile"],
        status: "planned"
      },
      {
        id: "shift_noah_am",
        driverId: "driver_noah",
        vehicleId: "vehicle_bike_1",
        vehicleTypeId: "vehicletype_bike",
        startAt: todayAt(8, 30),
        endAt: todayAt(15, 30),
        startCoordinates: { lat: 48.8619, lon: 2.3765 },
        endCoordinates: { lat: 48.8619, lon: 2.3765 },
        skills: ["cold_chain", "bike"],
        status: "planned"
      }
    ],
    pricingConfig: buildDefaultPricingConfig(),
    orders: [
      {
        id: "ops_001",
        merchantId: "merchant_demo",
        hubId: "hub_paris_central",
        kind: "delivery",
        reference: "NAAV-001",
        pickupAddress: {
          label: "Paris Central Hub",
          street1: "12 Rue du Depot",
          city: "Paris",
          postalCode: "75011",
          countryCode: "FR",
          contactName: "Hub Team",
          phone: "+33111111111",
          email: "pickup@naaval.app",
          parcelSize: "M",
          comment: "Dock A",
          coordinates: { lat: 48.8619, lon: 2.3765 }
        },
        dropoffAddress: {
          label: "Avenue Louise 231, 1050 Ixelles",
          street1: "Avenue Louise 231",
          city: "Ixelles",
          postalCode: "1050",
          countryCode: "BE",
          contactName: "Louise Client",
          phone: "+3220000001",
          email: "client1@example.com",
          parcelSize: "M",
          comment: "Reception desk",
          coordinates: { lat: 50.8247, lon: 4.3654 }
        },
        serviceDurationSeconds: 240,
        parcelCount: 3,
        weightKg: 12,
        volumeDm3: 60,
        requiredSkills: [],
        timeWindows: [{ start: todayAt(8, 45), end: todayAt(10, 0) }],
        priority: 1,
        notes: "Left with concierge after signature",
        status: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "ops_002",
        merchantId: "merchant_demo",
        hubId: "hub_paris_central",
        kind: "delivery",
        reference: "NAAV-002",
        pickupAddress: {
          label: "Rue du Bailli 19, 1050 Ixelles",
          street1: "Rue du Bailli 19",
          city: "Ixelles",
          postalCode: "1050",
          countryCode: "BE",
          contactName: "Store Pickup",
          phone: "+3220000002",
          email: "store@example.com",
          parcelSize: "L",
          comment: "Back entrance",
          coordinates: { lat: 50.8241, lon: 4.3577 }
        },
        dropoffAddress: {
          label: "Rue Defacqz 34, 1060 Saint-Gilles",
          street1: "Rue Defacqz 34",
          city: "Saint-Gilles",
          postalCode: "1060",
          countryCode: "BE",
          contactName: "Saint-Gilles Client",
          phone: "+3220000003",
          email: "client2@example.com",
          parcelSize: "L",
          comment: "Call on arrival",
          coordinates: { lat: 50.8261, lon: 4.3525 }
        },
        serviceDurationSeconds: 300,
        parcelCount: 2,
        weightKg: 8,
        volumeDm3: 35,
        requiredSkills: [],
        timeWindows: [{ start: todayAt(9, 30), end: todayAt(11, 0) }],
        priority: 2,
        notes: "Courier is 4 minutes ahead of ETA",
        status: "in_progress",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "ops_003",
        merchantId: "merchant_demo",
        hubId: "hub_paris_central",
        kind: "delivery",
        reference: "NAAV-003",
        pickupAddress: {
          label: "Paris Central Hub",
          street1: "12 Rue du Depot",
          city: "Paris",
          postalCode: "75011",
          countryCode: "FR",
          contactName: "Hub Team",
          phone: "+33111111111",
          email: "pickup@naaval.app",
          parcelSize: "S",
          comment: "Standard loading",
          coordinates: { lat: 48.8619, lon: 2.3765 }
        },
        dropoffAddress: {
          label: "Chaussee d'Alsemberg 81, 1190 Forest",
          street1: "Chaussee d'Alsemberg 81",
          city: "Forest",
          postalCode: "1190",
          countryCode: "BE",
          contactName: "Forest Client",
          phone: "+3220000004",
          email: "client3@example.com",
          parcelSize: "S",
          comment: "Leave with concierge",
          coordinates: { lat: 50.8178, lon: 4.3345 }
        },
        serviceDurationSeconds: 300,
        parcelCount: 1,
        weightKg: 5,
        volumeDm3: 18,
        requiredSkills: [],
        timeWindows: [{ start: todayAt(9, 50), end: todayAt(11, 15) }],
        priority: 3,
        notes: "High-priority customer reroute requested",
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "ops_004",
        merchantId: "merchant_demo",
        hubId: "hub_paris_central",
        kind: "delivery",
        reference: "NAAV-004",
        pickupAddress: {
          label: "Rue de Namur 45, 1000 Bruxelles",
          street1: "Rue de Namur 45",
          city: "Bruxelles",
          postalCode: "1000",
          countryCode: "BE",
          contactName: "Namur Store",
          phone: "+3220000005",
          email: "pickup4@example.com",
          parcelSize: "XL",
          comment: "Fragile cosmetics",
          coordinates: { lat: 50.8388, lon: 4.3602 }
        },
        dropoffAddress: {
          label: "Boulevard de Waterloo 12, 1000 Bruxelles",
          street1: "Boulevard de Waterloo 12",
          city: "Bruxelles",
          postalCode: "1000",
          countryCode: "BE",
          contactName: "Waterloo Client",
          phone: "+3220000006",
          email: "client4@example.com",
          parcelSize: "XL",
          comment: "Signature required",
          coordinates: { lat: 50.8381, lon: 4.3558 }
        },
        serviceDurationSeconds: 240,
        parcelCount: 4,
        weightKg: 18,
        volumeDm3: 90,
        requiredSkills: ["fragile"],
        timeWindows: [{ start: todayAt(11, 15), end: todayAt(13, 0) }],
        priority: 1,
        notes: "Fragile skincare products",
        status: "planned",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "ops_005",
        merchantId: "merchant_demo",
        hubId: "hub_paris_central",
        kind: "delivery",
        reference: "NAAV-005",
        pickupAddress: {
          label: "Rue du Trone 64, 1050 Ixelles",
          street1: "Rue du Trone 64",
          city: "Ixelles",
          postalCode: "1050",
          countryCode: "BE",
          contactName: "Cold Store",
          phone: "+3220000007",
          email: "pickup5@example.com",
          parcelSize: "M",
          comment: "Cold-chain handoff",
          coordinates: { lat: 50.8384, lon: 4.3724 }
        },
        dropoffAddress: {
          label: "Place Flagey 7, 1050 Ixelles",
          street1: "Place Flagey 7",
          city: "Ixelles",
          postalCode: "1050",
          countryCode: "BE",
          contactName: "Flagey Client",
          phone: "+3220000008",
          email: "client5@example.com",
          parcelSize: "M",
          comment: "Cold-chain priority",
          coordinates: { lat: 50.8275, lon: 4.3722 }
        },
        serviceDurationSeconds: 180,
        parcelCount: 2,
        weightKg: 7,
        volumeDm3: 28,
        requiredSkills: ["cold_chain"],
        timeWindows: [{ start: todayAt(12, 20), end: todayAt(14, 0) }],
        priority: 2,
        notes: "Cargo bike eligible",
        status: "planned",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "ops_006",
        merchantId: "merchant_demo",
        hubId: "hub_paris_central",
        kind: "pickup_delivery",
        reference: "NAAV-006",
        pickupAddress: {
          label: "Rue Oberkampf 9, Paris 11",
          street1: "Rue Oberkampf 9",
          city: "Paris",
          postalCode: "75011",
          countryCode: "FR",
          contactName: "Oberkampf Pickup",
          phone: "+33122222222",
          email: "pickup6@example.com",
          parcelSize: "L",
          comment: "Pickup at front desk",
          coordinates: { lat: 48.8654, lon: 2.3781 }
        },
        dropoffAddress: {
          label: "Rue des Dames 12, Paris 17",
          street1: "Rue des Dames 12",
          city: "Paris",
          postalCode: "75017",
          countryCode: "FR",
          contactName: "Rue des Dames Client",
          phone: "+33133333333",
          email: "client6@example.com",
          parcelSize: "L",
          comment: "Call before delivery",
          coordinates: { lat: 48.883, lon: 2.3232 }
        },
        serviceDurationSeconds: 300,
        parcelCount: 1,
        weightKg: 5,
        volumeDm3: 18,
        requiredSkills: [],
        timeWindows: [{ start: todayAt(14, 0), end: todayAt(16, 30) }],
        priority: 2,
        notes: "Pickup then direct drop",
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    routes: [
      {
        id: "route_1",
        planId: "plan_demo_a",
        shiftId: "shift_amina_am",
        driverId: "driver_amina",
        vehicleId: "vehicle_van_1",
        status: "completed",
        totalDistanceMeters: 16400,
        totalDurationSeconds: 2800,
        stops: [
          {
            id: "route_1_stop_1",
            orderId: "ops_001",
            sequence: 1,
            kind: "delivery",
            address: {
              label: "Avenue Louise 231, 1050 Ixelles",
              street1: "Avenue Louise 231",
              city: "Ixelles",
              postalCode: "1050",
              countryCode: "BE"
            },
            plannedArrivalAt: todayAt(8, 45),
            plannedDepartureAt: todayAt(9, 5),
            status: "served"
          }
        ]
      },
      {
        id: "route_2",
        planId: "plan_demo_b",
        shiftId: "shift_amina_am",
        driverId: "driver_amina",
        vehicleId: "vehicle_van_1",
        status: "in_progress",
        totalDistanceMeters: 11200,
        totalDurationSeconds: 2100,
        stops: [
          {
            id: "route_2_stop_1",
            orderId: "ops_002",
            sequence: 1,
            kind: "delivery",
            address: {
              label: "Rue Defacqz 34, 1060 Saint-Gilles",
              street1: "Rue Defacqz 34",
              city: "Saint-Gilles",
              postalCode: "1060",
              countryCode: "BE"
            },
            plannedArrivalAt: todayAt(9, 30),
            plannedDepartureAt: todayAt(9, 55),
            status: "arrived"
          }
        ]
      },
      {
        id: "route_3",
        planId: "plan_demo_c",
        shiftId: "shift_noah_am",
        driverId: "driver_noah",
        vehicleId: "vehicle_bike_1",
        status: "ready",
        totalDistanceMeters: 9800,
        totalDurationSeconds: 2400,
        stops: [
          {
            id: "route_3_stop_1",
            orderId: "ops_004",
            sequence: 1,
            kind: "delivery",
            address: {
              label: "Boulevard de Waterloo 12, 1000 Bruxelles",
              street1: "Boulevard de Waterloo 12",
              city: "Bruxelles",
              postalCode: "1000",
              countryCode: "BE"
            },
            plannedArrivalAt: todayAt(11, 15),
            plannedDepartureAt: todayAt(11, 35),
            status: "pending"
          },
          {
            id: "route_3_stop_2",
            orderId: "ops_005",
            sequence: 2,
            kind: "delivery",
            address: {
              label: "Place Flagey 7, 1050 Ixelles",
              street1: "Place Flagey 7",
              city: "Ixelles",
              postalCode: "1050",
              countryCode: "BE"
            },
            plannedArrivalAt: todayAt(12, 20),
            plannedDepartureAt: todayAt(12, 35),
            status: "pending"
          }
        ]
      }
    ],
    planningJobs: [
      {
        id: "plan_demo_a",
        hubId: "hub_paris_central",
        planDate: toDateKey(),
        orderIds: ["ops_001"],
        driverShiftIds: ["shift_amina_am"],
        objectivePreset: "speed",
        solver: "graphhopper",
        status: "finished",
        routeIds: ["route_1"],
        createdAt: new Date(Date.now() - 1000 * 60 * 150).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 150).toISOString(),
        completedAt: new Date(Date.now() - 1000 * 60 * 148).toISOString()
      },
      {
        id: "plan_demo_b",
        hubId: "hub_paris_central",
        planDate: toDateKey(),
        orderIds: ["ops_002"],
        driverShiftIds: ["shift_amina_am"],
        objectivePreset: "balanced",
        solver: "graphhopper",
        status: "finished",
        routeIds: ["route_2"],
        createdAt: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
        completedAt: new Date(Date.now() - 1000 * 60 * 92).toISOString()
      },
      {
        id: "plan_demo_c",
        hubId: "hub_paris_central",
        planDate: toDateKey(),
        orderIds: ["ops_004", "ops_005"],
        driverShiftIds: ["shift_noah_am"],
        objectivePreset: "distance",
        solver: "mock",
        status: "finished",
        routeIds: ["route_3"],
        createdAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
        completedAt: new Date(Date.now() - 1000 * 60 * 52).toISOString()
      }
    ]
  };
}

const VEHICLE_LABELS = {
  bike: "Bike",
  scooter: "Scooter",
  car: "Car",
  van_3m3: "3m3",
  van_5m3: "5m3",
  van_10m3: "10m3",
  van_15m3: "15m3",
  van_20m3: "20m3"
};

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function toDateKey(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);

  if (Number.isNaN(date.getTime())) {
    return state.selectedDate;
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown day";
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(date);
}

function formatDateTimeLabel(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(input) {
  return String(input ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() ?? "")
    .join("");
}

function capitalize(input) {
  return String(input ?? "")
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function labelForStatus(status) {
  const labels = {
    delivered: "Delivered",
    in_progress: "In Progress",
    upcoming: "Upcoming",
    emergency: "Emergency",
    planned: "Planned",
    dispatched: "Dispatched",
    active: "Active",
    idle: "Idle",
    completed: "Delivered",
    failed: "Failed",
    cancelled: "Cancelled",
    en_route_pickup: "En Route to Pickup",
    pickup_handed_over_to_tsp: "Handed Over to TSP",
    pickup_failed: "Failed Pickup",
    pickup_refused_by_tsp: "Refused by TSP",
    delivery_order_delivered: "Order Delivered",
    delivery_failed: "Failed",
    delivery_refused_by_customer: "Refused by Customer",
    arrived: "Arrived",
    served: "Served",
    skipped: "Skipped"
  };

  return labels[status] ?? capitalize(status);
}

function labelForReasonCode(code) {
  const labels = {
    customer_absent: "Customer absent",
    damaged: "Damaged goods",
    access_issue: "Access issue",
    site_closed: "Site closed",
    wrong_address: "Wrong address",
    tsp_absent: "TSP unavailable",
    tsp_refusal: "TSP refusal",
    customer_refusal: "Customer refusal",
    quality_issue: "Quality issue",
    rejected: "Refused",
    other: "Other"
  };

  return labels[code] ?? capitalize(code ?? "");
}

function toneForStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();

  if (["delivery_order_delivered", "delivered", "completed"].includes(value)) {
    return "delivered";
  }

  if (["delivery_failed", "delivery_refused_by_customer", "pickup_failed", "pickup_refused_by_tsp", "failed", "cancelled", "emergency", "skipped"].includes(value)) {
    return "emergency";
  }

  if (["pickup_handed_over_to_tsp", "active"].includes(value)) {
    return "active";
  }

  if (["in_progress", "en_route_pickup", "arrived", "served"].includes(value)) {
    return "in_progress";
  }

  if (["planned", "upcoming", "ready"].includes(value)) {
    return "planned";
  }

  if (value === "dispatched") {
    return "dispatched";
  }

  if (value === "idle") {
    return "idle";
  }

  return value || "planned";
}

function normalizeBackendStatus(status) {
  return toneForStatus(status ?? "upcoming");
}

function createTimeLabel(input) {
  const date = input ? new Date(input) : new Date();

  if (Number.isNaN(date.getTime())) {
    return "Soon";
  }

  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}h${minute}`;
}

function formatDistanceKm(meters) {
  if (!Number.isFinite(meters) || meters <= 0) {
    return "Pending";
  }

  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}

function formatDurationMinutes(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Pending";
  }

  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function estimateAmount(order) {
  const parcelSize =
    order.parcelSize ??
    order.dropoffAddress?.parcelSize ??
    order.pickupAddress?.parcelSize ??
    "M";
  const parcelCount = order.parcelCount ?? 1;
  const weightKg = order.weightKg ?? 0;
  const sizeBase = {
    S: 9.8,
    M: 14.4,
    L: 18.91,
    XL: 24.6,
    XXL: 29.8,
    Palette: 35
  }[parcelSize] ?? 14.4;

  return Math.round((sizeBase + Math.max(0, parcelCount - 1) * 1.8 + weightKg * 0.28) * 100) / 100;
}

function toAddressLabel(address) {
  if (!address) {
    return "Unknown";
  }

  return address.label ?? [address.street1, address.city].filter(Boolean).join(", ");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function joinNameParts(...parts) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function clampNumber(value, fallback, minimum = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(minimum, parsed);
}

function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

function getPricingConfig() {
  if (!state.pricingConfig) {
    state.pricingConfig = buildDefaultPricingConfig();
  }

  return state.pricingConfig;
}

function getPricingDraft() {
  if (!state.pricingDraft) {
    state.pricingDraft = buildDefaultPricingDraft();
  }

  return state.pricingDraft;
}

function ensurePricingState() {
  if (!state.pricingConfig) {
    state.pricingConfig = buildDefaultPricingConfig();
  }

  if (!state.pricingDraft) {
    state.pricingDraft = buildDefaultPricingDraft();
  }
}

function labelForVehicle(vehicleType) {
  return VEHICLE_LABELS[vehicleType] ?? capitalize(String(vehicleType).replaceAll("_", " "));
}

function labelForVehicleTypeId(vehicleTypeId) {
  if (String(vehicleTypeId ?? "").includes("bike")) {
    return "Cargo Bike";
  }

  if (String(vehicleTypeId ?? "").includes("van")) {
    return "Van";
  }

  if (String(vehicleTypeId ?? "").includes("car")) {
    return "Car";
  }

  return capitalize(vehicleTypeId ?? "Vehicle pending");
}

function labelForOpsRole(role) {
  const labels = {
    ops_admin: "Ops Admin",
    ops_manager: "Ops Manager",
    ops_dispatcher: "Dispatcher",
    ops_agent: "Ops Agent"
  };

  return labels[role] ?? capitalize(role ?? "ops_agent");
}

function getAdminPricingAlgoMeta(algoId) {
  return ADMIN_PRICING_ALGOS.find((algo) => algo.id === algoId) ?? ADMIN_PRICING_ALGOS[0];
}

function getAlgorithmLabel(algoId) {
  return getAdminPricingAlgoMeta(algoId).title;
}

function getStopOrderIds(stop) {
  const orderIds = [...new Set([...(stop?.orderIds ?? []), stop?.orderId].filter(Boolean))];
  return orderIds;
}

function getOrderRouteStops(route, orderId) {
  return (route?.stops ?? []).filter((stop) => getStopOrderIds(stop).includes(orderId) && ["pickup", "delivery"].includes(stop.kind));
}

function getOrderProgressSnapshot(order, route) {
  const executionStatus = order.status ?? order.sourceStatus;
  const routeStops = getOrderRouteStops(route, order.id);
  const totalStops = routeStops.length > 0 ? routeStops.length : order.kind === "pickup_delivery" || order.kind === "return" ? 2 : 1;
  let completedStops = routeStops.filter((stop) => ["served", "completed", "delivered", "failed", "skipped"].includes(stop.status)).length;

  if (["completed", "delivery_order_delivered"].includes(executionStatus) || route?.status === "completed") {
    completedStops = totalStops;
  }

  if (["delivery_failed", "delivery_refused_by_customer", "pickup_failed", "pickup_refused_by_tsp", "failed", "cancelled"].includes(executionStatus)) {
    return {
      completedStops: Math.max(1, completedStops),
      totalStops,
      progressLabel: null,
      visualStatus: "emergency"
    };
  }

  if (executionStatus === "pickup_handed_over_to_tsp") {
    return {
      completedStops: Math.max(1, completedStops),
      totalStops,
      progressLabel: `${Math.max(1, completedStops)}/${totalStops}`,
      visualStatus: "active"
    };
  }

  const activeStatuses = new Set(["in_progress", "completed", "delivered"]);
  const hasStarted = completedStops > 0 || activeStatuses.has(order.status) || activeStatuses.has(order.sourceStatus) || executionStatus === "en_route_pickup" || route?.status === "in_progress";
  const visualStatus =
    completedStops >= totalStops
      ? "delivered"
      : hasStarted
        ? "in_progress"
        : route
          ? "upcoming"
          : normalizeBackendStatus(order.status ?? order.sourceStatus);

  return {
    completedStops,
    totalStops,
    progressLabel: visualStatus === "in_progress" ? `${completedStops}/${totalStops}` : null,
    visualStatus
  };
}

function renderStatusStack(status, progressLabel = null) {
  return `
    <span class="status-stack">
      <span class="status-chip" data-status="${status}">${labelForStatus(status)}</span>
      ${progressLabel ? `<span class="status-stack__detail">${escapeHtml(progressLabel)}</span>` : ""}
    </span>
  `;
}

function renderLabeledStatusStack(statusTone, label, detail = null) {
  return `
    <span class="status-stack">
      <span class="status-chip" data-status="${escapeHtml(statusTone)}">${escapeHtml(label)}</span>
      ${detail ? `<span class="status-stack__detail">${escapeHtml(detail)}</span>` : ""}
    </span>
  `;
}

function getOrderStatusPresentation(order) {
  const statusCode = order.executionStatusCode ?? order.sourceStatus ?? order.status ?? "planned";
  const statusTone = order.executionStatusTone ?? toneForStatus(statusCode);
  const detailParts = [];

  if (order.statusProgressLabel) {
    detailParts.push(order.statusProgressLabel);
  }

  if (order.statusReason) {
    detailParts.push(order.statusReason);
  } else if (order.statusReasonCode) {
    detailParts.push(labelForReasonCode(order.statusReasonCode));
  }

  return {
    code: statusCode,
    tone: statusTone,
    label: order.executionStatusLabel ?? labelForStatus(statusCode),
    detail: detailParts.join(" • ") || null
  };
}

function renderOrderExecutionStatus(order) {
  const presentation = getOrderStatusPresentation(order);
  return renderLabeledStatusStack(presentation.tone, presentation.label, presentation.detail);
}

function coordinatesFromPoint(point) {
  if (Number.isFinite(point?.lat) && Number.isFinite(point?.lon)) {
    return point;
  }
  return null;
}

function projectPoint(point, bounds) {
  if (!point || !bounds) {
    return null;
  }

  const lonSpan = Math.max(0.0001, bounds.maxLon - bounds.minLon);
  const latSpan = Math.max(0.0001, bounds.maxLat - bounds.minLat);
  return {
    left: ((point.lon - bounds.minLon) / lonSpan) * 100,
    top: (1 - (point.lat - bounds.minLat) / latSpan) * 100
  };
}

function buildMapPoint(address) {
  const coordinates = address?.coordinates;
  if (Number.isFinite(coordinates?.lat) && Number.isFinite(coordinates?.lon)) {
    return `${coordinates.lat},${coordinates.lon}`;
  }

  return [address?.label, address?.street1, address?.postalCode, address?.city, address?.countryCode].filter(Boolean).join(", ");
}

function buildLiveTrackingMap(addresses = [], title = "Naaval Route Map", options = {}) {
  const routePoints = addresses
    .map((address) => coordinatesFromPoint(address?.coordinates))
    .filter(Boolean);
  const livePoint = coordinatesFromPoint(options.livePosition);
  const allPoints = livePoint ? [...routePoints, livePoint] : routePoints;

  if (allPoints.length === 0) {
    return null;
  }

  const lats = allPoints.map((point) => point.lat);
  const lons = allPoints.map((point) => point.lon);
  const padding = 0.02;
  const bounds = {
    minLat: Math.min(...lats) - padding,
    maxLat: Math.max(...lats) + padding,
    minLon: Math.min(...lons) - padding,
    maxLon: Math.max(...lons) + padding
  };
  const bbox = [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat].join(",");
  const marker = routePoints.at(-1) ?? livePoint;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(
    `${marker.lat},${marker.lon}`
  )}`;
  const pointPins = routePoints
    .map((point, index) => {
      const projected = projectPoint(point, bounds);
      if (!projected) {
        return "";
      }
      return `<span class="route-map__route-pin ${index === 0 ? "route-map__route-pin--start" : index === routePoints.length - 1 ? "route-map__route-pin--end" : ""}" style="left:${projected.left}%; top:${projected.top}%;" aria-hidden="true"></span>`;
    })
    .join("");
  const liveProjected = projectPoint(livePoint, bounds);
  const liveMarker = liveProjected
    ? `
      <span class="route-map__driver-pin" style="left:${liveProjected.left}%; top:${liveProjected.top}%;" aria-hidden="true"></span>
      <span class="route-map__driver-badge">${escapeHtml(options.liveLabel ?? "Driver live")}</span>
    `
    : "";

  return `
    <div class="route-map route-map--embed route-map--tracked">
      <iframe class="route-map__frame" title="${escapeHtml(title)}" loading="lazy" src="${src}"></iframe>
      <div class="route-map__overlay" aria-hidden="true">
        ${pointPins}
        ${liveMarker}
      </div>
    </div>
  `;
}

function buildMapEmbed(addresses = [], title = "Naaval Route Map", options = {}) {
  if (options.livePosition) {
    const trackedMap = buildLiveTrackingMap(addresses, title, options);
    if (trackedMap) {
      return trackedMap;
    }
  }

  const mapQueries = addresses.map(buildMapPoint).filter(Boolean);
  const points = addresses
    .map((address) => address?.coordinates)
    .filter((coordinates) => Number.isFinite(coordinates?.lat) && Number.isFinite(coordinates?.lon));

  if (mapQueries.length === 0) {
    return `<div class="route-map route-map--empty" aria-hidden="true"></div>`;
  }

  const googleKey = getOpsConfigValue("NAAVAL_GOOGLE_MAPS_EMBED_KEY");
  const preferredProvider = String(getOpsConfigValue("NAAVAL_MAP_PROVIDER") || (googleKey ? "google" : "osm")).toLowerCase();

  if (googleKey && preferredProvider === "google") {
    if (mapQueries.length >= 2) {
      const params = new URLSearchParams({
        key: googleKey,
        origin: mapQueries[0],
        destination: mapQueries.at(-1),
        mode: "driving"
      });

      const waypoints = mapQueries.slice(1, -1).join("|");
      if (waypoints) {
        params.set("waypoints", waypoints);
      }

      return `<div class="route-map route-map--embed"><iframe class="route-map__frame" title="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps/embed/v1/directions?${params.toString()}"></iframe></div>`;
    }

    const params = new URLSearchParams({
      key: googleKey,
      q: mapQueries[0]
    });
    return `<div class="route-map route-map--embed"><iframe class="route-map__frame" title="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps/embed/v1/place?${params.toString()}"></iframe></div>`;
  }

  if (points.length === 0) {
    return `
      <div class="route-map route-map--empty">
        <div>
          <strong>Map setup pending</strong>
          <p>Add coordinates to the order or configure Google Maps in <code>ops-config.js</code>.</p>
        </div>
      </div>
    `;
  }

  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const padding = 0.02;
  const bbox = [
    Math.min(...lons) - padding,
    Math.min(...lats) - padding,
    Math.max(...lons) + padding,
    Math.max(...lats) + padding
  ].join(",");
  const marker = `${points.at(-1).lat},${points.at(-1).lon}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`;
  return `<div class="route-map route-map--embed"><iframe class="route-map__frame" title="${escapeHtml(title)}" loading="lazy" src="${src}"></iframe></div>`;
}

function tagsForDriver(driver) {
  return (driver.skills ?? []).map((skill) => {
    if (skill === "cold_chain") {
      return "🧊 Frigo";
    }

    if (skill === "bike") {
      return "🚲 2 roues";
    }

    if (skill === "ev" || skill === "electric") {
      return "⚡ EV";
    }

    if (skill === "fragile") {
      return "📦 Fragile";
    }

    return `🏷️ ${capitalize(skill)}`;
  });
}

function deriveCustomerId(address, merchantId) {
  const label = address?.label ?? address?.street1 ?? "customer";
  return `customer_${merchantId ?? "merchant"}_${label}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildCustomersFromOrders(orders) {
  const groups = new Map();

  for (const order of orders) {
    const address = order.dropoffAddress ?? {};
    const customerId = deriveCustomerId(address, order.merchantId);
    const existing =
      groups.get(customerId) ??
      {
        id: customerId,
        name: address.label ?? address.street1 ?? "Customer pending",
        merchantId: order.merchantId ?? "merchant_demo",
        addressLabel: toAddressLabel(address),
        city: address.city ?? "City pending",
        status: "dormant",
        orderCount: 0,
        liveOrders: 0,
        deliveredOrders: 0,
        totalRevenue: 0,
        preferredCourier: "Unassigned",
        tags: new Set(),
        orders: [],
        lastActivityAt: order.updatedAt ?? order.createdAt ?? new Date().toISOString()
      };

    existing.orderCount += 1;
    existing.totalRevenue += estimateAmount(order);
    existing.orders.push(order);
    existing.lastActivityAt = [existing.lastActivityAt, order.updatedAt ?? order.createdAt]
      .filter(Boolean)
      .sort()
      .at(-1);

    if (["ready", "planned", "dispatched", "in_progress"].includes(order.sourceStatus ?? order.status) || order.status === "upcoming") {
      existing.liveOrders += 1;
    }

    if ((order.sourceStatus ?? order.status) === "completed" || order.status === "delivered") {
      existing.deliveredOrders += 1;
    }

    for (const skill of order.requiredSkills ?? []) {
      existing.tags.add(skill);
    }

    groups.set(customerId, existing);
  }

  return [...groups.values()]
    .map((customer) => {
      const courierCounts = new Map();

      customer.orders.forEach((order) => {
        if (order.courier && order.courier !== "Unassigned") {
          courierCounts.set(order.courier, (courierCounts.get(order.courier) ?? 0) + 1);
        }
      });

      const preferredCourier =
        [...courierCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Unassigned";

      return {
        ...customer,
        status: customer.liveOrders > 0 ? "active" : "idle",
        totalRevenue: roundPrice(customer.totalRevenue),
        preferredCourier,
        pricingAlgorithmId: customer.orders[0]?.pricingAlgorithmId ?? "basic",
        tags: [...customer.tags].map((tag) => {
          if (tag === "cold_chain") {
            return "🧊 Frigo";
          }

          if (tag === "fragile") {
            return "📦 Fragile";
          }

          return `🏷️ ${capitalize(tag)}`;
        })
      };
    })
    .sort((left, right) => right.orderCount - left.orderCount || left.name.localeCompare(right.name));
}

function buildAccountCustomers(customers = [], quotes = []) {
  const quoteCountByCustomerId = quotes.reduce((counts, quote) => {
    counts.set(quote.customerId, (counts.get(quote.customerId) ?? 0) + 1);
    return counts;
  }, new Map());

  return customers.map((customer) => ({
    id: customer.id,
    name: customer.companyName,
    merchantId: "account",
    addressLabel: customer.headquartersAddress,
    city: customer.headquartersAddress?.split(",").at(-1)?.trim() || "Paris",
    status: "active",
    orderCount: 0,
    liveOrders: 0,
    deliveredOrders: 0,
    totalRevenue: 0,
    preferredCourier: "Unassigned",
    tags: [`🧾 ${quoteCountByCustomerId.get(customer.id) ?? 0} quotes`, `🏢 ${capitalize(customer.companySize ?? "smb")}`],
    orders: [],
    quotes: quotes.filter((quote) => quote.customerId === customer.id),
    lastActivityAt: customer.updatedAt ?? customer.createdAt ?? new Date().toISOString(),
    companyEmail: customer.companyEmail,
    companyPhone: customer.companyPhone,
    contactName: joinNameParts(customer.contactFirstName, customer.contactLastName),
    contactEmail: customer.contactEmail,
    contactPhone: customer.contactPhone,
    revenueRange: customer.revenueRange,
    vatNumber: customer.vatNumber,
    pricingAlgorithmId: customer.pricingAlgorithmId ?? quotes.find((quote) => quote.customerId === customer.id)?.source ?? "basic"
  }));
}

function buildCustomerDirectory(orderCustomers, accountCustomers) {
  const byId = new Map();

  for (const customer of accountCustomers) {
    byId.set(customer.id, { ...customer });
  }

  for (const customer of orderCustomers) {
    const existing = [...byId.values()].find(
      (candidate) =>
        candidate.name.toLowerCase() === customer.name.toLowerCase() ||
        candidate.companyEmail === customer.orders?.[0]?.dropoffAddress?.email ||
        candidate.contactEmail === customer.orders?.[0]?.dropoffAddress?.email
    );

    if (!existing) {
      byId.set(customer.id, customer);
      continue;
    }

    existing.orderCount += customer.orderCount;
    existing.liveOrders += customer.liveOrders;
    existing.deliveredOrders += customer.deliveredOrders;
    existing.totalRevenue = roundPrice((existing.totalRevenue ?? 0) + customer.totalRevenue);
    existing.orders = [...(existing.orders ?? []), ...(customer.orders ?? [])];
    existing.tags = [...new Set([...(existing.tags ?? []), ...(customer.tags ?? [])])];
    existing.addressLabel = existing.addressLabel || customer.addressLabel;
    existing.preferredCourier = customer.preferredCourier !== "Unassigned" ? customer.preferredCourier : existing.preferredCourier;
    existing.pricingAlgorithmId = existing.pricingAlgorithmId || customer.pricingAlgorithmId || "basic";
  }

  return [...byId.values()].sort((left, right) => (right.orderCount ?? 0) - (left.orderCount ?? 0) || left.name.localeCompare(right.name));
}

function formatRecurringDays(codes = []) {
  const selected = RECURRING_DAY_OPTIONS.filter((option) => codes.includes(option.code));
  if (selected.length === 7) {
    return "Daily";
  }

  if (selected.length === 5 && !codes.includes("sat") && !codes.includes("sun")) {
    return "Weekdays";
  }

  return selected.map((option) => option.label).join(", ") || "Flexible";
}

function getRecurringNextRunLabel(codes = [], pickupTime = "08:00") {
  const selected = RECURRING_DAY_OPTIONS.filter((option) => codes.includes(option.code));
  if (selected.length === 0) {
    return "Next run pending";
  }

  const first = selected[0];
  return `${first.label} ${pickupTime.replace(":", "h")}`;
}

function normalizeStoredRecurringRoute(route) {
  const orders = (route.orders ?? []).map((order, index) => ({
    id: order.id ?? `${route.id}_order_${index + 1}`,
    reference: order.reference ?? `${route.reference ?? route.label ?? route.id}-${index + 1}`,
    dropoffLabel: order.dropoffLabel ?? toAddressLabel(order.dropoffAddress),
    timeLabel: order.timeLabel ?? route.windowLabel ?? "Pending",
    status: order.status ?? "planned",
    pickupAddress: order.pickupAddress ?? route.pickupAddress,
    dropoffAddress: order.dropoffAddress,
    pricingAlgorithmId: order.pricingAlgorithmId ?? route.pricingAlgorithmId ?? "basic",
    kind: order.kind ?? route.kind ?? "delivery"
  }));
  const recurringDays = route.recurringDays ?? [];

  return {
    ...route,
    source: route.source ?? "manual",
    recurringDays,
    frequency: route.frequency ?? formatRecurringDays(recurringDays),
    windowLabel: route.windowLabel ?? (route.pickupTime ? `${route.pickupTime.replace(":", "h")} pickup` : "Flexible start"),
    nextRunLabel: route.nextRunLabel ?? getRecurringNextRunLabel(recurringDays, route.pickupTime ?? "08:00"),
    stopCount: route.stopCount ?? orders.length,
    customerCount: route.customerCount ?? new Set(orders.map((order) => order.dropoffLabel)).size,
    tags: route.tags ?? [],
    orders
  };
}

function buildRecurringRoutesFromData(orders, drivers, shifts, hubs) {
  const readyOrders = orders.filter(
    (order) =>
      ["ready", "planned", "dispatched", "in_progress"].includes(order.sourceStatus ?? order.status) || order.status === "upcoming"
  );
  const coldChainOrders = readyOrders.filter((order) => (order.requiredSkills ?? []).includes("cold_chain"));
  const pickupOrders = readyOrders.filter((order) => ["pickup_delivery", "return"].includes(order.kind));
  const generalOrders = readyOrders.filter((order) => !coldChainOrders.includes(order) && !pickupOrders.includes(order));
  const templates = [];
  const defaultHub = hubs[0]?.label ?? "Central Hub";

  function buildTemplate(id, label, sourceOrders, frequency, note, skillMatch = null) {
    if (sourceOrders.length === 0) {
      return null;
    }

    const shift =
      shifts.find((candidate) => !skillMatch || (candidate.skills ?? []).includes(skillMatch)) ??
      shifts[0] ??
      null;
    const driver = drivers.find((candidate) => candidate.id === shift?.driverId) ?? null;
    const uniqueCustomers = new Set(sourceOrders.map((order) => toAddressLabel(order.dropoffAddress)));
    const primaryWindow = sourceOrders
      .map((order) => order.timeWindows?.[0]?.start)
      .filter(Boolean)
      .sort()[0];

    templates.push({
      id,
      label,
      frequency,
      hubLabel: defaultHub,
      driverName: driver?.name ?? "Unassigned",
      vehicleLabel: labelForVehicleTypeId(shift?.vehicleTypeId),
      stopCount: sourceOrders.length,
      customerCount: uniqueCustomers.size,
      windowLabel: primaryWindow ? `${createTimeLabel(primaryWindow)} start` : "Flexible start",
      nextRunLabel: frequency === "Weekdays" ? "Tomorrow 08h00" : "Next run pending",
      status: driver ? "active" : "planned",
      source: "generated",
      recurringDays: frequency === "Weekdays" ? ["mon", "tue", "wed", "thu", "fri"] : ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      pickupTime: primaryWindow ? createTimeLabel(primaryWindow).replace("h", ":") : "08:00",
      tags: [
        `🔁 ${frequency}`,
        `🚚 ${labelForVehicleTypeId(shift?.vehicleTypeId)}`,
        driver ? `👤 ${driver.name}` : "👤 Unassigned"
      ],
      note,
      orders: sourceOrders
    });
  }

  buildTemplate(
    "rr_morning_wave",
    "Morning City Wave",
    generalOrders.slice(0, 4),
    "Weekdays",
    "Standard city-center delivery wave from the main hub."
  );
  buildTemplate(
    "rr_cold_chain",
    "Cold Chain Loop",
    coldChainOrders.slice(0, 4),
    "Weekdays",
    "Dedicated refrigerated loop for temperature-controlled customers.",
    "cold_chain"
  );
  buildTemplate(
    "rr_pickup_returns",
    "Pickup & Returns Sweep",
    pickupOrders.slice(0, 4),
    "Daily",
    "Collect returns and pickup-delivery missions in a single recurring route."
  );

  return templates;
}

function getOrderOperationalDate(order) {
  return order.windowStart ?? order.updatedAt ?? order.createdAt ?? null;
}

function getVisibleOrders() {
  return state.orders.filter((order) => toDateKey(getOrderOperationalDate(order)) === state.selectedDate);
}

function getVisibleRoutes() {
  const visibleOrderIds = new Set(getVisibleOrders().map((order) => order.id));
  return state.routes.filter((route) => route.stops?.some((stop) => getStopOrderIds(stop).some((orderId) => visibleOrderIds.has(orderId))));
}

function canOrderBePlanned(order) {
  return !order.routeId && (order.sourceStatus === "ready" || order.sourceStatus === "planned");
}

function getSelectedPlanningOrders() {
  const selectedIds = new Set(state.selectedPlanningOrderIds);
  return getVisibleOrders().filter((order) => selectedIds.has(order.id));
}

function isOrderSelectedForPlanning(orderId) {
  return state.selectedPlanningOrderIds.includes(orderId);
}

function togglePlanningOrderSelection(orderId, checked = null) {
  const selected = new Set(state.selectedPlanningOrderIds);
  const nextChecked = checked ?? !selected.has(orderId);
  if (nextChecked) {
    selected.add(orderId);
  } else {
    selected.delete(orderId);
  }
  state.selectedPlanningOrderIds = [...selected];
}

function selectAllVisibleOrdersForPlanning() {
  state.selectedPlanningOrderIds = getVisibleOrders()
    .filter((order) => canOrderBePlanned(order))
    .map((order) => order.id);
}

function clearVisiblePlanningSelection() {
  state.selectedPlanningOrderIds = [];
}

function getVisibleCustomers() {
  return state.customers;
}

function getVisibleRecurringRoutes() {
  return state.recurringRoutes;
}

function buildInvoicesFromOrders(orders) {
  const groups = new Map();

  for (const order of orders) {
    const dateKey = toDateKey(getOrderOperationalDate(order));
    const customerName = order.dropoffAddress?.contactName ?? order.dropoffAddress?.label ?? order.dropoffLabel;
    const customerId = deriveCustomerId(order.dropoffAddress, order.merchantId);
    const key = `${dateKey}__${customerId}`;
    const existing =
      groups.get(key) ??
      {
        id: `invoice_${key}`,
        number: `INV-${dateKey.replaceAll("-", "")}-${groups.size + 1}`,
        dateKey,
        customerName,
        merchantId: order.merchantId ?? "merchant_demo",
        billingAddress: toAddressLabel(order.dropoffAddress),
        orderCount: 0,
        amount: 0,
        orders: [],
        status: "draft"
      };

    existing.orderCount += 1;
    existing.amount += estimateAmount(order);
    existing.orders.push(order);

    if ((order.sourceStatus ?? order.status) === "completed" || order.status === "delivered") {
      existing.status = "issued";
    } else if ((order.sourceStatus ?? order.status) === "failed") {
      existing.status = "review";
    }

    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((invoice) => ({
      ...invoice,
      amount: roundPrice(invoice.amount)
    }))
    .sort((left, right) => right.amount - left.amount || left.customerName.localeCompare(right.customerName));
}

function getVisibleInvoices() {
  return buildInvoicesFromOrders(getVisibleOrders());
}

function calculateBasicPrice(config = getPricingConfig(), draft = getPricingDraft()) {
  const size = draft.basic.parcelSize ?? "L";
  const distanceKm = clampNumber(draft.basic.distanceKm, 0);
  const basePrice = config.basic.sizeBasePrices[size] ?? config.basic.sizeBasePrices.L;
  const total = roundPrice(basePrice + distanceKm * (config.basic.distanceRatePerKm ?? 0));

  return {
    size,
    distanceKm,
    total
  };
}

function recommendPalletVehicle(config = getPricingConfig(), palletCount = getPricingDraft().pallet.palletCount) {
  const thresholds = Object.entries(config.pallet.vehicleThresholds ?? {}).sort((left, right) => left[1] - right[1]);

  for (const [vehicleType, maxPallets] of thresholds) {
    if (palletCount <= maxPallets) {
      return vehicleType;
    }
  }

  return thresholds[thresholds.length - 1]?.[0] ?? "van_20m3";
}

function calculatePalletPrice(config = getPricingConfig(), draft = getPricingDraft()) {
  const palletCount = clampNumber(draft.pallet.palletCount, 0, 1);
  const roundTrips = clampNumber(draft.pallet.roundTrips, 1, 1);
  const pricePerPallet = config.pallet.pricePerPallet ?? 0;

  return {
    palletCount,
    roundTrips,
    vehicleType: recommendPalletVehicle(config, palletCount),
    total: roundPrice(palletCount * roundTrips * pricePerPallet)
  };
}

function calculateHourlyPrice(config = getPricingConfig(), draft = getPricingDraft()) {
  const minimumHours = config.hours.minimumHours ?? 1;
  const enteredHours = clampNumber(draft.hours.hours, minimumHours, 0.5);
  const billedHours = Math.max(minimumHours, enteredHours);
  const vehicleType = draft.hours.vehicleType ?? "van_3m3";
  const hourlyRate = config.hours.vehicleHourlyRates?.[vehicleType] ?? 0;

  return {
    enteredHours,
    billedHours,
    vehicleType,
    hourlyRate,
    total: roundPrice(billedHours * hourlyRate)
  };
}

function calculateDropPrice(config = getPricingConfig(), draft = getPricingDraft()) {
  const minimumDrops = config.drops.minimumDrops ?? 1;
  const requestedDrops = clampNumber(draft.drops.drops, minimumDrops, 1);
  const billedDrops = Math.max(minimumDrops, requestedDrops);
  const vehicleType = draft.drops.vehicleType ?? "van_3m3";
  const dropRate = config.drops.vehicleDropRates?.[vehicleType] ?? 0;

  return {
    requestedDrops,
    billedDrops,
    vehicleType,
    dropRate,
    total: roundPrice(billedDrops * dropRate)
  };
}

function updatePricingDraft(path, rawValue) {
  ensurePricingState();

  if (path === "basic.distanceKm") {
    state.pricingDraft.basic.distanceKm = clampNumber(rawValue, 0);
    return;
  }

  if (path === "pallet.palletCount") {
    state.pricingDraft.pallet.palletCount = clampNumber(rawValue, 1, 1);
    return;
  }

  if (path === "pallet.roundTrips") {
    state.pricingDraft.pallet.roundTrips = clampNumber(rawValue, 1, 1);
    return;
  }

  if (path === "hours.hours") {
    state.pricingDraft.hours.hours = clampNumber(rawValue, 1, 1);
    return;
  }

  if (path === "drops.drops") {
    state.pricingDraft.drops.drops = clampNumber(rawValue, 1, 1);
  }
}

function setPricingSelection(scope, value) {
  ensurePricingState();

  if (scope === "basic.size") {
    state.pricingDraft.basic.parcelSize = value;
    return;
  }

  if (scope === "hours.vehicle") {
    state.pricingDraft.hours.vehicleType = value;
    return;
  }

  if (scope === "drops.vehicle") {
    state.pricingDraft.drops.vehicleType = value;
  }
}

function getQuoteContextForSource(source) {
  const config = getPricingConfig();
  const draft = getPricingDraft();

  if (source === "basic") {
    const result = calculateBasicPrice(config, draft);
    return {
      source,
      label: "Basic Algo",
      amount: result.total,
      description: `Parcel size ${result.size} - ${result.distanceKm} km`
    };
  }

  if (source === "pallet") {
    const result = calculatePalletPrice(config, draft);
    return {
      source,
      label: "Palette",
      amount: result.total,
      description: `${result.palletCount} pallet(s) - ${labelForVehicle(result.vehicleType)}`
    };
  }

  if (source === "hours") {
    const result = calculateHourlyPrice(config, draft);
    return {
      source,
      label: "By Hours",
      amount: result.total,
      description: `${result.billedHours} h - ${labelForVehicle(result.vehicleType)}`
    };
  }

  const result = calculateDropPrice(config, draft);
  return {
    source,
    label: "By Drop",
    amount: result.total,
    description: `${result.billedDrops} drops - ${labelForVehicle(result.vehicleType)}`
  };
}

function syncQuoteForm() {
  const sourceInput = document.querySelector("#quote-source");
  const amountInput = document.querySelector("#quote-amount");
  const sourceLabel = document.querySelector("#quote-source-label");
  const amountLabel = document.querySelector("#quote-amount-label");

  if (!sourceInput || !amountInput || !sourceLabel || !amountLabel || !state.quoteContext) {
    return;
  }

  sourceInput.value = state.quoteContext.source;
  amountInput.value = String(state.quoteContext.amount);
  sourceLabel.value = `${state.quoteContext.label} - ${state.quoteContext.description}`;
  amountLabel.value = formatCurrency(state.quoteContext.amount);
}

function escapePdfText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function buildPdfBlob(lines) {
  const sanitizedLines = lines.map((line) => escapePdfText(line));
  const content = [
    "BT",
    "/F1 12 Tf",
    "50 790 Td",
    ...sanitizedLines.flatMap((line, index) => (index === 0 ? [`(${line}) Tj`] : [`0 -18 Td`, `(${line}) Tj`])),
    "ET"
  ].join("\n");

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj"
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function showToast(message, variant = "info") {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.background = variant === "error" ? "rgba(176, 38, 38, 0.94)" : "rgba(12, 91, 74, 0.92)";

  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer);
  }

  state.toastTimer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

function openModal(name) {
  document.querySelector(`#${name}-modal`)?.classList.remove("hidden");
  if (name === "quote") {
    syncQuoteForm();
  }

  if (name === "optimizer-time") {
    renderOptimizerTimeModal();
  }
}

function setCustomerModalPresentation(editing = false) {
  const title = document.querySelector("#customer-modal-title");
  const subtitle = document.querySelector("#customer-modal-subtitle");
  const submitButton = document.querySelector("#customer-submit-button");
  if (title) {
    title.textContent = editing ? "Edit Customer" : "Create Customer";
  }
  if (subtitle) {
    subtitle.textContent = editing
      ? "Update the CRM account details, pricing defaults, and portal access for this customer."
      : "Create a customer account once, then reuse it across ops, quotes, and the client portal.";
  }
  if (submitButton) {
    submitButton.textContent = editing ? "Save Customer" : "Create Customer";
  }
}

function resolveEditableCustomer(customerId) {
  const accountCustomer = state.accountCustomers.find((candidate) => candidate.id === customerId);
  if (accountCustomer) {
    return {
      id: accountCustomer.id,
      companyName: accountCustomer.companyName ?? "",
      headquartersAddress: accountCustomer.headquartersAddress ?? "",
      vatNumber: accountCustomer.vatNumber ?? "",
      companyPhone: accountCustomer.companyPhone ?? "",
      companyEmail: accountCustomer.companyEmail ?? "",
      contactFirstName: accountCustomer.contactFirstName ?? "",
      contactLastName: accountCustomer.contactLastName ?? "",
      contactPhone: accountCustomer.contactPhone ?? "",
      contactEmail: accountCustomer.contactEmail ?? "",
      revenueRange: accountCustomer.revenueRange ?? "0-500k",
      companySize: accountCustomer.companySize ?? "smb",
      pricingAlgorithmId: accountCustomer.pricingAlgorithmId ?? "basic"
    };
  }

  const customer = getVisibleCustomers().find((candidate) => candidate.id === customerId) ?? state.customers.find((candidate) => candidate.id === customerId);
  if (!customer) {
    return null;
  }

  const [contactFirstName = "", ...rest] = String(customer.contactName ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    id: customer.id,
    companyName: customer.name ?? "",
    headquartersAddress: customer.addressLabel ?? "",
    vatNumber: customer.vatNumber ?? "",
    companyPhone: customer.companyPhone ?? "",
    companyEmail: customer.companyEmail ?? "",
    contactFirstName,
    contactLastName: rest.join(" "),
    contactPhone: customer.contactPhone ?? "",
    contactEmail: customer.contactEmail ?? "",
    revenueRange: customer.revenueRange ?? "0-500k",
    companySize: customer.companySize ?? "smb",
    pricingAlgorithmId: customer.pricingAlgorithmId ?? "basic"
  };
}

function openCustomerModal(customerId = null) {
  closeModal("customer-detail");
  const form = document.querySelector("#customer-form");
  form?.reset();
  const editableCustomer = customerId ? resolveEditableCustomer(customerId) : null;
  const isEditing = Boolean(editableCustomer);

  if (form?.elements.customerId) {
    form.elements.customerId.value = editableCustomer?.id ?? "";
  }
  if (form?.elements.companyName) {
    form.elements.companyName.value = editableCustomer?.companyName ?? "";
  }
  if (form?.elements.headquartersAddress) {
    form.elements.headquartersAddress.value = editableCustomer?.headquartersAddress ?? "";
  }
  if (form?.elements.vatNumber) {
    form.elements.vatNumber.value = editableCustomer?.vatNumber ?? "";
  }
  if (form?.elements.companyPhone) {
    form.elements.companyPhone.value = editableCustomer?.companyPhone ?? "";
  }
  if (form?.elements.companyEmail) {
    form.elements.companyEmail.value = editableCustomer?.companyEmail ?? "";
  }
  if (form?.elements.contactFirstName) {
    form.elements.contactFirstName.value = editableCustomer?.contactFirstName ?? "";
  }
  if (form?.elements.contactLastName) {
    form.elements.contactLastName.value = editableCustomer?.contactLastName ?? "";
  }
  if (form?.elements.contactPhone) {
    form.elements.contactPhone.value = editableCustomer?.contactPhone ?? "";
  }
  if (form?.elements.contactEmail) {
    form.elements.contactEmail.value = editableCustomer?.contactEmail ?? "";
  }
  if (form?.elements.pricingAlgorithmId) {
    form.elements.pricingAlgorithmId.value = editableCustomer?.pricingAlgorithmId ?? "basic";
  }
  if (form?.elements.revenueRange) {
    form.elements.revenueRange.value = editableCustomer?.revenueRange ?? "0-500k";
  }
  if (form?.elements.companySize) {
    form.elements.companySize.value = editableCustomer?.companySize ?? "smb";
  }
  setCustomerModalPresentation(isEditing);
  openModal("customer");
}

function setDriverModalPresentation(editing = false) {
  const title = document.querySelector("#driver-modal-title");
  const subtitle = document.querySelector("#driver-modal-subtitle");
  const submitButton = document.querySelector("#driver-submit-button");
  if (title) {
    title.textContent = editing ? "Edit Driver" : "Add Driver";
  }
  if (subtitle) {
    subtitle.textContent = editing
      ? "Update the driver profile, tags, vehicle type, and carrier company assignment. Leave truck photos empty to keep the current ones."
      : "Create a driver profile for dispatch and route assignment.";
  }
  if (submitButton) {
    submitButton.textContent = editing ? "Save Driver" : "Create Driver";
  }
}

function openDriverModal(driverId = null) {
  closeModal("driver-detail");
  const form = document.querySelector("#driver-form");
  form?.reset();
  syncCarrierCompanyOptions();
  const driver = driverId ? state.drivers.find((candidate) => candidate.id === driverId) : null;
  const isEditing = Boolean(driver);

  if (form?.elements.driverId) {
    form.elements.driverId.value = driver?.id ?? "";
  }
  if (form?.elements.firstName) {
    form.elements.firstName.value = driver?.firstName ?? "";
  }
  if (form?.elements.lastName) {
    form.elements.lastName.value = driver?.lastName ?? "";
  }
  if (form?.elements.email) {
    form.elements.email.value = driver?.email ?? "";
  }
  if (form?.elements.phone) {
    form.elements.phone.value = driver?.phone && driver.phone !== "No phone provided" ? driver.phone : "";
  }
  if (form?.elements.skills) {
    form.elements.skills.value = (driver?.skills ?? []).join(", ");
  }
  if (form?.elements.vehicleType) {
    form.elements.vehicleType.value = driver?.vehicleType ?? "van_3m3";
  }
  if (form?.elements.carrierCompanyId) {
    form.elements.carrierCompanyId.value = driver?.carrierCompanyId ?? "";
  }
  if (form?.elements.carrierCompanyName) {
    form.elements.carrierCompanyName.value = "";
  }
  if (form?.elements.carrierCompanyLegalName) {
    form.elements.carrierCompanyLegalName.value = "";
  }
  if (form?.elements.carrierCompanyEmail) {
    form.elements.carrierCompanyEmail.value = "";
  }
  if (form?.elements.carrierCompanyPhone) {
    form.elements.carrierCompanyPhone.value = "";
  }
  setDriverModalPresentation(isEditing);
  openModal("driver");
}

function closeModal(name) {
  document.querySelector(`#${name}-modal`)?.classList.add("hidden");
  if (name === "optimizer-time") {
    state.optimizerTimeField = null;
  }
}

function closeAllModals() {
  closeModal("order");
  closeModal("driver");
  closeModal("customer");
  closeModal("carrier-company");
  closeModal("recurring-route");
  closeModal("optimizer-time");
  closeModal("admin-pricing");
  closeModal("ops-user-detail");
  closeModal("order-detail");
  closeModal("driver-detail");
  closeModal("customer-detail");
  closeModal("recurring-route-detail");
  closeModal("quote");
  closeModal("quote-email");
}

function persistSession(session) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function restoreSession() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function updateAuthUi() {
  const gate = document.querySelector("#login-gate");
  if (!gate) {
    return;
  }

  gate.classList.toggle("hidden", state.isAuthenticated);
  document.body.classList.toggle("auth-locked", !state.isAuthenticated);
}

function decodeJwtPayload(token) {
  if (!token) {
    return null;
  }

  try {
    const [, payload] = token.split(".");
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function findOpsUserByEmail(email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return state.opsUsers.find((user) => String(user.email ?? "").trim().toLowerCase() === normalized) ?? null;
}

function setupGoogleIdentity(retryCount = 0) {
  const slot = document.querySelector("#google-login-slot");
  const fallbackButton = document.querySelector("#google-login-button");
  if (!slot || !fallbackButton) {
    return;
  }

  slot.innerHTML = "";
  fallbackButton.classList.add("hidden");

  const clientId = getOpsConfigValue("NAAVAL_GOOGLE_CLIENT_ID");
  if (!clientId) {
    fallbackButton.classList.remove("hidden");
    return;
  }

  if (!window.google?.accounts?.id) {
    fallbackButton.classList.remove("hidden");
    if (retryCount < 10) {
      window.clearTimeout(googleIdentityRetryTimer);
      googleIdentityRetryTimer = window.setTimeout(() => setupGoogleIdentity(retryCount + 1), 400);
    }
    return;
  }

  window.clearTimeout(googleIdentityRetryTimer);
  googleIdentityRetryTimer = null;

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredentialResponse
  });

  window.google.accounts.id.renderButton(slot, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "continue_with",
    width: 360,
    logo_alignment: "left"
  });

  if (!state.isAuthenticated && getBooleanOpsConfigValue("NAAVAL_GOOGLE_ONE_TAP")) {
    window.google.accounts.id.prompt();
  }
}

function handleGoogleCredentialResponse(response) {
  const payload = decodeJwtPayload(response?.credential);
  if (!payload?.email) {
    showToast("Google login failed.", "error");
    return;
  }

  const matchingUser = findOpsUserByEmail(payload.email);
  if (!matchingUser && !payload.email.endsWith("@naaval.app")) {
    showToast("This Google account is not registered as an ops user yet.", "error");
    return;
  }

  loginWithProfile(
    matchingUser ?? {
      id: payload.sub ?? "ops_google_live",
      firstName: payload.given_name ?? "Google",
      lastName: payload.family_name ?? "User",
      name: payload.name,
      email: payload.email
    },
    "google"
  );
  showToast(`Google login successful for ${payload.email}.`);
}

function loginWithProfile(profile, source = "password") {
  state.isAuthenticated = true;
  state.currentUser = {
    id: profile.id ?? createId("session"),
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    name: profile.name ?? joinNameParts(profile.firstName, profile.lastName) ?? "Ops User",
    email: profile.email,
    source
  };
  persistSession(state.currentUser);
  updateAuthUi();
  render();
}

function logout() {
  state.isAuthenticated = false;
  state.currentUser = null;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.google?.accounts?.id?.disableAutoSelect?.();
  updateAuthUi();
  setupGoogleIdentity();
  render();
}

async function fetchJson(path) {
  const errors = [];

  for (const baseUrl of API_BASE_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}${path}`);

      if (!response.ok) {
        const message = await readErrorMessage(response);
        const error = new Error(message || `HTTP ${response.status}`);
        error.fatal = Boolean(state.apiBaseUrl && baseUrl === state.apiBaseUrl && response.status >= 400 && response.status < 500);
        throw error;
      }

      state.apiBaseUrl = baseUrl;
      return await response.json();
    } catch (error) {
      if (error?.fatal) {
        throw error;
      }
      errors.push(`${baseUrl}: ${error.message}`);
    }
  }

  throw new Error(`Failed to fetch ${path}. ${errors.join(" | ")}`);
}

async function readErrorMessage(response) {
  const contentType = response.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      return payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    }

    const text = await response.text();
    if (!text) {
      return `HTTP ${response.status}`;
    }

    try {
      const payload = JSON.parse(text);
      return payload?.error?.message || payload?.message || text;
    } catch (_error) {
      return text;
    }
  } catch (_error) {
    return `HTTP ${response.status}`;
  }
}

async function postJson(path, payload) {
  const candidates = state.apiBaseUrl ? [state.apiBaseUrl, ...API_BASE_CANDIDATES.filter((url) => url !== state.apiBaseUrl)] : API_BASE_CANDIDATES;
  const errors = [];

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        const error = new Error(message || `HTTP ${response.status}`);
        error.fatal = Boolean(state.apiBaseUrl && baseUrl === state.apiBaseUrl && response.status >= 400 && response.status < 500);
        throw error;
      }

      state.apiBaseUrl = baseUrl;
      return await response.json();
    } catch (error) {
      if (error?.fatal) {
        throw error;
      }
      errors.push(`${baseUrl}: ${error.message}`);
    }
  }

  throw new Error(`Failed to post ${path}. ${errors.join(" | ")}`);
}

async function patchJson(path, payload) {
  const candidates = state.apiBaseUrl ? [state.apiBaseUrl, ...API_BASE_CANDIDATES.filter((url) => url !== state.apiBaseUrl)] : API_BASE_CANDIDATES;
  const errors = [];

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        const error = new Error(message || `HTTP ${response.status}`);
        error.fatal = Boolean(state.apiBaseUrl && baseUrl === state.apiBaseUrl && response.status >= 400 && response.status < 500);
        throw error;
      }

      state.apiBaseUrl = baseUrl;
      return await response.json();
    } catch (error) {
      if (error?.fatal) {
        throw error;
      }
      errors.push(`${baseUrl}: ${error.message}`);
    }
  }

  throw new Error(`Failed to patch ${path}. ${errors.join(" | ")}`);
}

async function deleteJson(path) {
  const candidates = state.apiBaseUrl ? [state.apiBaseUrl, ...API_BASE_CANDIDATES.filter((url) => url !== state.apiBaseUrl)] : API_BASE_CANDIDATES;
  const errors = [];

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        const error = new Error(message || `HTTP ${response.status}`);
        error.fatal = Boolean(state.apiBaseUrl && baseUrl === state.apiBaseUrl && response.status >= 400 && response.status < 500);
        throw error;
      }

      state.apiBaseUrl = baseUrl;
      return response.status === 204 ? {} : await response.json();
    } catch (error) {
      if (error?.fatal) {
        throw error;
      }
      errors.push(`${baseUrl}: ${error.message}`);
    }
  }

  throw new Error(`Failed to delete ${path}. ${errors.join(" | ")}`);
}

function mapDomainData(db) {
  const driverById = new Map(db.drivers.map((driver) => [driver.id, driver]));
  const shiftByDriverId = new Map();

  for (const shift of db.shifts) {
    if (!shiftByDriverId.has(shift.driverId)) {
      shiftByDriverId.set(shift.driverId, []);
    }

    shiftByDriverId.get(shift.driverId).push(shift);
  }

  const routesByDriverId = new Map();
  const routeByOrderId = new Map();

  for (const route of db.routes) {
    if (!routesByDriverId.has(route.driverId)) {
      routesByDriverId.set(route.driverId, []);
    }

    routesByDriverId.get(route.driverId).push(route);

    for (const stop of route.stops ?? []) {
      for (const orderId of getStopOrderIds(stop)) {
        if (!routeByOrderId.has(orderId)) {
          routeByOrderId.set(orderId, route);
        }
      }
    }
  }

  state.hubs = clone(db.hubs);
  state.shifts = clone(db.shifts);
  state.routes = clone(db.routes);
  state.carrierCompanies = clone(db.carrierCompanies ?? []);
  state.opsUsers = clone(db.opsUsers ?? []);
  state.accountCustomers = clone(db.customers ?? []);
  state.quotes = clone(db.quotes ?? []);
  state.planningJobs = clone(db.planningJobs ?? []).sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  state.inboxMessages = clone(db.inboxMessages ?? state.inboxMessages ?? []);
  state.graphhopperUsage = clone(
    db.graphhopperUsage ?? {
      enabled: false,
      remaining: null,
      limit: null,
      resetSeconds: null,
      updatedAt: null
    }
  );

  state.orders = db.orders.map((order) => {
    const route = routeByOrderId.get(order.id);
    const driver = route?.driverId ? driverById.get(route.driverId) : null;
    const primaryWindow = order.timeWindows?.[0];
    const fallbackHubLabel =
      db.hubs.find((hub) => hub.id === order.hubId)?.label ??
      db.hubs[0]?.label ??
      "Hub pending";
    const progress = getOrderProgressSnapshot(order, route);

    return {
      id: order.id,
      reference: order.reference,
      merchantId: order.merchantId,
      hubId: order.hubId,
      kind: order.kind,
      pricingAlgorithmId: order.pricingAlgorithmId ?? "basic",
      pickupAddress: clone(order.pickupAddress ?? null),
      dropoffAddress: clone(order.dropoffAddress ?? null),
      pickupCoordinates: clone(order.pickupAddress?.coordinates ?? null),
      dropoffCoordinates: clone(order.dropoffAddress?.coordinates ?? null),
      requiredSkills: clone(order.requiredSkills ?? []),
      parcelCount: order.parcelCount ?? 1,
      parcelSize: order.parcelSize ?? order.dropoffAddress?.parcelSize ?? order.pickupAddress?.parcelSize ?? "M",
      weightKg: order.weightKg ?? 0,
      volumeDm3: order.volumeDm3 ?? 0,
      windowStart: primaryWindow?.start ?? null,
      windowEnd: primaryWindow?.end ?? null,
      createdAt: order.createdAt ?? null,
      updatedAt: order.updatedAt ?? null,
      sourceStatus: order.status,
      executionStatusCode: order.status ?? progress.visualStatus,
      executionStatusTone: toneForStatus(order.status ?? progress.visualStatus),
      executionStatusLabel: labelForStatus(order.status ?? progress.visualStatus),
      status: progress.visualStatus,
      statusProgressLabel: progress.progressLabel,
      statusMessage: order.statusMessage ?? null,
      statusReason: order.statusReason ?? order.lastProofNote ?? null,
      statusReasonCode: order.statusReasonCode ?? null,
      statusReasonLabel: order.statusReasonLabel ?? (order.statusReasonCode ? labelForReasonCode(order.statusReasonCode) : null),
      pickupLabel: order.pickupAddress ? toAddressLabel(order.pickupAddress) : fallbackHubLabel,
      dropoffLabel: toAddressLabel(order.dropoffAddress),
      courier: driver?.name ?? "Unassigned",
      courierId: driver?.id ?? null,
      timeLabel: createTimeLabel(primaryWindow?.start ?? route?.stops?.[0]?.plannedArrivalAt),
      amount: estimateAmount(order),
      durationLabel: route ? `${Math.max(12, Math.round((route.totalDurationSeconds ?? 900) / 60))} min` : "Pending",
      notes: order.notes || "No operator note yet",
      routeStatus: route ? capitalize(route.status) : "Awaiting planning",
      routeId: route?.id ?? null,
      routeState: route?.status ?? null,
      livePosition: clone(order.lastKnownPosition ?? route?.lastKnownPosition ?? null),
      livePositionAt: order.lastKnownPositionAt ?? route?.lastHeartbeatAt ?? null,
      livePositionLabel: order.lastKnownPositionLabel ?? null,
      lastProofOutcomeCode: order.lastProofOutcomeCode ?? null,
      lastProofOutcomeLabel: order.lastProofOutcomeLabel ?? null,
      lastProofId: order.lastProofId ?? null,
      proofPhotoUrls: clone(order.lastProofPhotoUrls ?? []),
      lastProofNote: order.lastProofNote ?? null,
      lastProofDeliveredAt: order.lastProofDeliveredAt ?? null,
      stops:
        route?.stops?.map((stop) => ({
          label: stop.kind === "pickup" ? "Pickup" : stop.kind === "break" ? "Break" : "Delivery",
          address: toAddressLabel(stop.address),
          time: createTimeLabel(stop.plannedArrivalAt),
          status: stop.status ?? "pending",
          statusCode: stop.proofOutcomeCode ?? stop.status ?? "pending",
          statusTone: toneForStatus(stop.proofOutcomeCode ?? stop.status ?? "pending"),
          statusLabel: labelForStatus(stop.proofOutcomeCode ?? stop.status ?? "pending"),
          reasonCode: stop.reasonCode ?? null,
          reasonLabel: stop.reasonLabel ?? (stop.reasonCode ? labelForReasonCode(stop.reasonCode) : null),
          note: stop.note ?? null
        })) ?? [
          {
            label: order.kind === "pickup_delivery" || order.kind === "return" ? "Pickup" : "Delivery",
            address: toAddressLabel(order.kind === "pickup_delivery" || order.kind === "return" ? order.pickupAddress : order.dropoffAddress),
            time: createTimeLabel(primaryWindow?.start),
            status: progress.visualStatus === "delivered" ? "completed" : "pending",
            statusCode: order.status ?? progress.visualStatus,
            statusTone: toneForStatus(order.status ?? progress.visualStatus),
            statusLabel: labelForStatus(order.status ?? progress.visualStatus),
            reasonCode: order.statusReasonCode ?? null,
            reasonLabel: order.statusReasonLabel ?? (order.statusReasonCode ? labelForReasonCode(order.statusReasonCode) : null),
            note: order.statusReason ?? order.lastProofNote ?? null
          }
        ],
      totals: {
        parcelCount: order.parcelCount ?? 1,
        weightKg: order.weightKg ?? 0,
        revenue: estimateAmount(order)
      }
    };
  });

  state.drivers = db.drivers.map((driver) => {
    const shifts = shiftByDriverId.get(driver.id) ?? [];
    const routes = routesByDriverId.get(driver.id) ?? [];
    const activeRoutes = routes.filter((route) => route.status !== "completed" && route.status !== "cancelled");
    const completedRoutes = routes.filter((route) => route.status === "completed");
    const activeRoute = activeRoutes[0] ?? null;
    const primaryShift = shifts[0] ?? null;

    return {
      id: driver.id,
      name: driver.name,
      firstName: driver.firstName ?? driver.name?.split(" ")[0] ?? "",
      lastName: driver.lastName ?? driver.name?.split(" ").slice(1).join(" ") ?? "",
      email: driver.email ?? "",
      phone: driver.phone ?? "No phone provided",
      skills: driver.skills ?? [],
      tags: tagsForDriver(driver),
      status: activeRoute ? "active" : "idle",
      rawStatus: driver.status ?? "active",
      vehicleTypeLabel: labelForVehicle(driver.vehicleType ?? primaryShift?.vehicleTypeId?.replace("vehicletype_", "") ?? "van_3m3"),
      vehicleType: driver.vehicleType ?? primaryShift?.vehicleTypeId?.replace("vehicletype_", "") ?? "van_3m3",
      carrierCompanyId: driver.carrierCompanyId ?? null,
      carrierCompanyName: (db.carrierCompanies ?? []).find((company) => company.id === driver.carrierCompanyId)?.name ?? "Independent",
      vehiclePhotoUrls: clone(driver.vehiclePhotoUrls ?? []),
      shiftSummary:
        primaryShift
          ? `${createTimeLabel(primaryShift.startAt)} - ${createTimeLabel(primaryShift.endAt)}`
          : "No shift configured",
      shiftCount: shifts.length,
      routeCount: routes.length,
      assignedRoutes: activeRoutes.length,
      completedRoutes: completedRoutes.length,
      activeRouteId: activeRoute?.id ?? null,
      activeRouteStatus: activeRoute?.status ?? null,
      ordersHandled: routes.reduce((total, route) => total + new Set((route.stops ?? []).flatMap((stop) => getStopOrderIds(stop))).size, 0),
      currentNotes:
        activeRoute
          ? `${Math.max(1, activeRoute.stops?.filter((stop) => stop.status === "pending").length ?? 0)} pending stops`
          : "Ready for assignment"
    };
  });

  state.customers = buildCustomerDirectory(buildCustomersFromOrders(state.orders), buildAccountCustomers(state.accountCustomers, state.quotes));
  const storedRecurringRoutes = (db.recurringRoutes ?? []).map((route) => ({ ...route }));
  const suppressedRecurringIds = new Set(storedRecurringRoutes.filter((route) => route.suppressed).map((route) => route.id));
  const manualRecurringRoutes = storedRecurringRoutes.filter((route) => !route.suppressed).map(normalizeStoredRecurringRoute);
  const generatedRecurringRoutes = buildRecurringRoutesFromData(state.orders, state.drivers, state.shifts, state.hubs).filter(
    (route) => !suppressedRecurringIds.has(route.id) && !manualRecurringRoutes.some((manualRoute) => manualRoute.id === route.id)
  );
  state.recurringRoutes = [...manualRecurringRoutes, ...generatedRecurringRoutes];
}

function getDefaultHubId() {
  return state.hubs[0]?.id ?? state.orders.find((order) => order.hubId)?.hubId ?? "hub_paris_central";
}

async function loadFromApi() {
  const [
    ordersResponse,
    routesResponse,
    driversResponse,
    shiftsResponse,
    hubsResponse,
    healthResponse,
    pricingResponse,
    opsUsersResponse,
    carrierCompaniesResponse,
    customersResponse,
    quotesResponse,
    recurringRoutesResponse,
    planningJobsResponse,
    graphhopperUsageResponse,
    inboxMessagesResponse
  ] = await Promise.all([
    fetchJson("/orders"),
    fetchJson("/routes"),
    fetchJson("/fleet/drivers"),
    fetchJson("/fleet/shifts"),
    fetchJson("/fleet/hubs"),
    fetchJson("/health"),
    fetchJson("/pricing/config").catch(() => ({ config: buildDefaultPricingConfig() })),
    fetchJson("/admin/users").catch(() => ({ items: [] })),
    fetchJson("/fleet/carrier-companies").catch(() => ({ items: [] })),
    fetchJson("/customers").catch(() => ({ items: [] })),
    fetchJson("/quotes").catch(() => ({ items: [] })),
    fetchJson("/recurring-routes").catch(() => ({ items: [] })),
    fetchJson("/planning/jobs").catch(() => ({ items: [] })),
    fetchJson("/graphhopper/usage").catch(() => ({ enabled: false, remaining: null, limit: null, updatedAt: null })),
    fetchJson("/inbox/messages").catch(() => ({ items: [] }))
  ]);

  mapDomainData({
    orders: ordersResponse.items ?? [],
    routes: routesResponse.items ?? [],
    drivers: driversResponse.items ?? [],
    shifts: shiftsResponse.items ?? [],
    hubs: hubsResponse.items ?? [],
    opsUsers: opsUsersResponse.items ?? [],
    carrierCompanies: carrierCompaniesResponse.items ?? [],
    customers: customersResponse.items ?? [],
    quotes: quotesResponse.items ?? [],
    recurringRoutes: recurringRoutesResponse.items ?? [],
    planningJobs: planningJobsResponse.items ?? [],
    graphhopperUsage: graphhopperUsageResponse ?? { enabled: false },
    inboxMessages: inboxMessagesResponse.items ?? []
  });

  state.pricingConfig = clone(pricingResponse.config ?? buildDefaultPricingConfig());
  ensurePricingState();
  state.apiAvailable = true;
  state.dataMode = state.apiBaseUrl.includes(":8787") ? "Integrated Local Server" : "Live API";
  state.solverMode = healthResponse.solver === "graphhopper-enabled" ? "GraphHopper Ready" : "Mock Mode";
}

function loadFromLocal() {
  if (!localDb) {
    localDb = buildFallbackDb();
  }

  mapDomainData(localDb);
  state.pricingConfig = clone(localDb.pricingConfig ?? buildDefaultPricingConfig());
  ensurePricingState();
  state.apiAvailable = false;
  state.dataMode = "Local Prototype";
  state.solverMode = localDb.graphhopperUsage?.enabled ? "GraphHopper Ready" : "Prototype Planner";
}

function ensureSelections() {
  const visibleOrders = getVisibleOrders();
  const visibleCustomers = getVisibleCustomers();
  const visibleRecurringRoutes = getVisibleRecurringRoutes();
  const visibleRoutes = getVisibleRoutes();
  const planningJobs = state.planningJobs;
  const opsUsers = state.opsUsers;
  const inboxThreads = getInboxThreads(state.selectedInboxAudience);
  const visibleOrderIds = new Set(visibleOrders.map((order) => order.id));

  state.selectedPlanningOrderIds = state.selectedPlanningOrderIds.filter((orderId) => visibleOrderIds.has(orderId));

  if (!visibleOrders.some((order) => order.id === state.selectedOrderId)) {
    state.selectedOrderId = visibleOrders[0]?.id ?? state.orders[0]?.id ?? null;
  }

  if (!state.drivers.some((driver) => driver.id === state.selectedDriverId)) {
    state.selectedDriverId = state.drivers[0]?.id ?? null;
  }

  if (!visibleCustomers.some((customer) => customer.id === state.selectedCustomerId)) {
    state.selectedCustomerId = visibleCustomers[0]?.id ?? state.customers[0]?.id ?? null;
  }

  if (!visibleRecurringRoutes.some((route) => route.id === state.selectedRecurringRouteId)) {
    state.selectedRecurringRouteId = visibleRecurringRoutes[0]?.id ?? state.recurringRoutes[0]?.id ?? null;
  }

  if (!visibleRoutes.some((route) => route.id === state.selectedOptimizerRouteId)) {
    state.selectedOptimizerRouteId = visibleRoutes[0]?.id ?? null;
  }

  if (!planningJobs.some((job) => job.id === state.selectedPlanningJobId)) {
    state.selectedPlanningJobId = planningJobs[0]?.id ?? null;
  }

  state.selectedComparePlanIds = state.selectedComparePlanIds.filter((planId) => planningJobs.some((job) => job.id === planId)).slice(0, 2);

  if (!opsUsers.some((user) => user.id === state.selectedOpsUserId)) {
    state.selectedOpsUserId = opsUsers[0]?.id ?? null;
  }
  if (!opsUsers.some((user) => user.id === state.editingOpsUserId)) {
    state.editingOpsUserId = null;
  }

  if (!inboxThreads.some((thread) => thread.id === state.selectedInboxThreadId)) {
    state.selectedInboxThreadId = inboxThreads[0]?.id ?? null;
  }
}

async function refreshData(showMessage = false) {
  try {
    await loadFromApi();
    if (showMessage) {
      showToast("Data refreshed from core-api.");
    }
  } catch (_error) {
    loadFromLocal();
    if (showMessage) {
      showToast("API unavailable. Using local prototype data instead.", "error");
    }
  }

  ensureSelections();
  syncFormDefaults();
  render();
}

function syncOpsLiveRefreshLoop() {
  if (opsLiveRefreshTimer) {
    window.clearInterval(opsLiveRefreshTimer);
    opsLiveRefreshTimer = null;
  }

  opsLiveRefreshTimer = window.setInterval(() => {
    const detailOpen = !document.querySelector("#order-detail-modal")?.classList.contains("hidden");
    if (!state.isAuthenticated || !state.apiAvailable) {
      return;
    }
    if (state.activeView !== "orders" && !detailOpen) {
      return;
    }
    void refreshData(false);
  }, 15000);
}

async function refreshGraphhopperUsage({ rerender = true } = {}) {
  if (!state.apiAvailable || state.graphhopperUsageLoading) {
    return;
  }

  state.graphhopperUsageLoading = true;

  try {
    const usage = await fetchJson("/graphhopper/usage");
    state.graphhopperUsage = {
      enabled: Boolean(usage?.enabled),
      remaining: usage?.remaining ?? null,
      limit: usage?.limit ?? null,
      resetSeconds: usage?.resetSeconds ?? null,
      updatedAt: usage?.updatedAt ?? null,
      source: usage?.source ?? null
    };
  } catch (_error) {
    // Keep the last known credit snapshot if the endpoint is temporarily unavailable.
  } finally {
    state.graphhopperUsageLoading = false;
  }

  if (rerender) {
    render();
  }
}

function ensureGraphhopperUsageLoaded() {
  if (!state.apiAvailable || state.activeView !== "optimizer") {
    return;
  }

  if (state.graphhopperUsageLoading || state.graphhopperUsage?.limit || state.graphhopperUsage?.remaining) {
    return;
  }

  void refreshGraphhopperUsage();
}

function renderDropoffSection(index, removeAction = "remove-drop") {
  return `
    <article class="dropoff-card" data-drop-index="${index}">
      <div class="dropoff-card__header">
        <strong>Drop ${index + 1}</strong>
        ${index > 0 ? `<button class="subtle-button subtle-button--small" type="button" data-action="${removeAction}" data-drop-index="${index}">Remove</button>` : ""}
      </div>
      <div class="form-grid">
        <label class="field">
          <span>Nom</span>
          <input name="dropoffFirstName_${index}" placeholder="Claire" />
        </label>

        <label class="field">
          <span>Prenom</span>
          <input name="dropoffLastName_${index}" placeholder="Dubois" />
        </label>

        <label class="field field--wide">
          <span>Dropoff / Site</span>
          <input name="dropoffLabel_${index}" placeholder="Client site, store, patient, office..." required />
        </label>

        <label class="field field--wide">
          <span>Address</span>
          <input name="dropoffStreet1_${index}" placeholder="12 Rue Example" required />
        </label>

        <label class="field">
          <span>City</span>
          <input name="dropoffCity_${index}" value="Paris" />
        </label>

        <label class="field">
          <span>Postal Code</span>
          <input name="dropoffPostalCode_${index}" value="75011" />
        </label>

        <label class="field">
          <span>Country</span>
          <input name="dropoffCountryCode_${index}" value="FR" />
        </label>

        <label class="field">
          <span>Telephone</span>
          <input name="dropoffPhone_${index}" placeholder="+33600000000" />
        </label>

        <label class="field">
          <span>Email</span>
          <input name="dropoffEmail_${index}" type="email" placeholder="dropoff@client.com" />
        </label>

        <label class="field">
          <span>Parcel Size</span>
          <select name="dropoffParcelSize_${index}">
            <option value="S">S</option>
            <option value="M" selected>M</option>
            <option value="L">L</option>
            <option value="XL">XL</option>
            <option value="XXL">XXL</option>
            <option value="Palette">Palette</option>
          </select>
        </label>

        <label class="field field--wide">
          <span>Commentaires</span>
          <textarea name="dropoffComment_${index}" rows="2" placeholder="Customer access, floor, intercom, special instructions..."></textarea>
        </label>
      </div>
    </article>
  `;
}

function ensureDropoffSections(listSelector = "#dropoff-list", removeAction = "remove-drop") {
  const list = document.querySelector(listSelector);
  if (!list) {
    return;
  }

  if (list.children.length === 0) {
    list.innerHTML = renderDropoffSection(0, removeAction);
  }
}

function renumberDropoffSections(listSelector = "#dropoff-list", removeAction = "remove-drop") {
  const list = document.querySelector(listSelector);
  const cards = list ? [...list.querySelectorAll(".dropoff-card")] : [];

  cards.forEach((card, index) => {
    card.setAttribute("data-drop-index", String(index));
    card.querySelector(".dropoff-card__header strong").textContent = `Drop ${index + 1}`;
    const removeButton = card.querySelector(`[data-action='${removeAction}']`);
    if (removeButton) {
      removeButton.setAttribute("data-drop-index", String(index));
      removeButton.classList.toggle("hidden", index === 0);
    }

    for (const field of card.querySelectorAll("[name]")) {
      const originalName = field.getAttribute("name");
      if (!originalName) {
        continue;
      }

      field.setAttribute("name", originalName.replace(/_\d+$/, `_${index}`));
    }
  });
}

function addDropoffSection(listSelector = "#dropoff-list", removeAction = "remove-drop") {
  const list = document.querySelector(listSelector);
  if (!list) {
    return;
  }

  const index = list.children.length;
  list.insertAdjacentHTML("beforeend", renderDropoffSection(index, removeAction));
}

function removeDropoffSection(index, listSelector = "#dropoff-list", removeAction = "remove-drop") {
  const list = document.querySelector(listSelector);
  const card = list?.querySelector(`.dropoff-card[data-drop-index="${index}"]`);
  card?.remove();
  renumberDropoffSections(listSelector, removeAction);
}

function syncCarrierCompanyOptions() {
  const select = document.querySelector("#carrier-company-select");
  if (!select) {
    return;
  }

  const selectedValue = state.pendingCarrierCompanyId || select.value;
  const options = [
    `<option value="">Independent driver / create new below</option>`,
    ...state.carrierCompanies.map(
      (company) => `<option value="${company.id}">${escapeHtml(company.name ?? company.legalName ?? company.id)}</option>`
    )
  ];

  select.innerHTML = options.join("");
  if ([...select.options].some((option) => option.value === selectedValue)) {
    select.value = selectedValue;
  }
  state.pendingCarrierCompanyId = null;
}

function updateRecurringDayUi(form) {
  if (!form) {
    return;
  }

  const selectedDays = new Set(
    String(form.elements.recurringDays?.value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );

  form.querySelectorAll("[data-action='toggle-recurring-day']").forEach((button) => {
    const isActive = selectedDays.has(button.getAttribute("data-day"));
    button.classList.toggle("weekday-pill--active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncFormDefaults() {
  const orderForm = document.querySelector("#order-form");
  if (orderForm) {
    orderForm.elements.hubId.value = getDefaultHubId();
    const selectedCustomer = state.customers.find((customer) => customer.id === state.selectedCustomerId);
    if (orderForm.elements.pricingAlgorithmId) {
      orderForm.elements.pricingAlgorithmId.value = selectedCustomer?.pricingAlgorithmId ?? state.selectedPricingAlgo ?? "basic";
    }
  }

  const recurringForm = document.querySelector("#recurring-route-form");
  if (recurringForm) {
    recurringForm.elements.hubId.value = getDefaultHubId();
    recurringForm.elements.pricingAlgorithmId.value = state.selectedPricingAlgo ?? "basic";
    if (!recurringForm.elements.recurringDays.value) {
      recurringForm.elements.recurringDays.value = "mon,tue,wed,thu,fri";
    }
    if (!recurringForm.elements.recurringPickupTime.value) {
      recurringForm.elements.recurringPickupTime.value = "08:00";
    }
    updateRecurringDayUi(recurringForm);
  }

  const dateInput = document.querySelector("#selected-date");
  if (dateInput) {
    dateInput.value = state.selectedDate;
  }

  syncCarrierCompanyOptions();
  ensureDropoffSections();
  ensureDropoffSections("#recurring-dropoff-list", "remove-recurring-drop");
}

function renderNav() {
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("nav__item--active", button.getAttribute("data-view") === state.activeView);
  }
}

function renderMetrics() {
  const visibleOrders = getVisibleOrders();
  const readyOrders = visibleOrders.filter((order) => !order.routeId && (order.sourceStatus === "ready" || order.sourceStatus === "planned")).length;
  const liveRoutes = getVisibleRoutes().filter((route) => route.status !== "completed" && route.status !== "cancelled").length;
  const dailyRevenue = visibleOrders
    .filter((order) => (order.sourceStatus ?? order.status) !== "failed")
    .reduce((total, order) => total + order.amount, 0);

  document.querySelector("#metric-orders").textContent = String(visibleOrders.length);
  document.querySelector("#metric-ready").textContent = String(readyOrders);
  document.querySelector("#metric-drivers").textContent = String(state.drivers.length);
  document.querySelector("#metric-routes").textContent = String(liveRoutes);
  document.querySelector("#metric-revenue").textContent = formatCurrency(dailyRevenue);
  document.querySelector("#data-mode").textContent = state.dataMode;
  document.querySelector("#solver-mode").textContent = state.solverMode;
  const sessionMode = document.querySelector("#session-mode");
  if (sessionMode) {
    sessionMode.textContent = state.isAuthenticated ? `${String(state.currentUser?.source ?? "").startsWith("google") ? "Google" : "Ops"} Session` : "Locked";
  }
  document.querySelector("#logout-button")?.classList.toggle("hidden", !state.isAuthenticated);
}

function renderToolbar() {
  const toolbar = document.querySelector("#toolbar-actions");

  if (state.activeView === "orders") {
    toolbar.innerHTML = `
      <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
      <button class="ghost-button" type="button" data-action="export-orders">Export</button>
      <button class="solid-button" type="button" data-open-modal="order">New Order</button>
    `;
    return;
  }

  if (state.activeView === "drivers") {
    toolbar.innerHTML = `
      <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
      <button class="ghost-button" type="button" data-open-modal="carrier-company">Add Carrier Company</button>
      <button class="solid-button" type="button" data-open-modal="driver">Add Driver</button>
    `;
    return;
  }

  if (state.activeView === "optimizer") {
    toolbar.innerHTML = "";
    return;
  }

  if (state.activeView === "customers" || state.activeView === "pricing") {
    toolbar.innerHTML =
      state.activeView === "customers"
        ? `
            <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
            <button class="ghost-button" type="button" data-action="open-customer-portal">Open Portal</button>
            <button class="solid-button" type="button" data-action="open-create-customer">Create Customer</button>
          `
        : `
            <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
          `;
    return;
  }

  if (state.activeView === "recurring-routes") {
    toolbar.innerHTML = `
      <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
      <button class="solid-button" type="button" data-open-modal="recurring-route">Create Recurring Delivery</button>
    `;
    return;
  }

  if (state.activeView === "inbox") {
    toolbar.innerHTML = `
      <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
    `;
    return;
  }

  if (state.activeView === "admin") {
    toolbar.innerHTML =
      state.adminSection === "pricing"
        ? `
            <button class="ghost-button" type="button" data-action="reset-pricing-config">Reset Defaults</button>
            <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
          `
        : `
            <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
          `;
    return;
  }

  toolbar.innerHTML = `
    <button class="ghost-button" type="button" data-action="refresh">Refresh</button>
  `;
}

function renderPanelHeader() {
  const eyebrow = document.querySelector("#panel-eyebrow");
  const title = document.querySelector("#panel-title");
  const subtitle = document.querySelector("#panel-subtitle");

  if (state.activeView === "orders") {
    eyebrow.textContent = "Operations";
    title.textContent = "My Orders";
    subtitle.textContent = "Create and supervise delivery orders, then inspect route and assignment details.";
    return;
  }

  if (state.activeView === "drivers") {
    eyebrow.textContent = "Fleet";
    title.textContent = "Drivers";
    subtitle.textContent = "See who is available, what they are carrying, and which routes are already assigned.";
    return;
  }

  if (state.activeView === "optimizer") {
    eyebrow.textContent = "Planning";
    title.textContent = "Optimizer";
    subtitle.textContent = "Launch VRP planning across ready orders and active shifts, then dispatch the resulting routes.";
    return;
  }

  if (state.activeView === "customers") {
    eyebrow.textContent = "CRM";
    title.textContent = "Customers";
    subtitle.textContent = "Track customer accounts, delivery history, preferred couriers, and active service relationships.";
    return;
  }

  if (state.activeView === "inbox") {
    eyebrow.textContent = "Messaging";
    title.textContent = "Inbox";
    subtitle.textContent = "Chat with customers and drivers from a WhatsApp-style operational inbox linked to the ops workspace.";
    return;
  }

  if (state.activeView === "recurring-routes") {
    eyebrow.textContent = "Planning";
    title.textContent = "Recurring Routes";
    subtitle.textContent = "Pilot recurring route templates, their assigned capacity, and the customer mix covered on each wave.";
    return;
  }

  if (state.activeView === "pricing") {
    eyebrow.textContent = "Revenue";
    title.textContent = "Pricing Simulator";
    subtitle.textContent = "Simulate last-mile pricing across parcel, pallet, hourly, and drop-based algorithms using the current admin rules.";
    return;
  }

  if (state.activeView === "admin") {
    eyebrow.textContent = "Configuration";
    title.textContent = "Admin";
    subtitle.textContent = "Switch between pricing algo setup and ops user creation from the admin control surface.";
    return;
  }

  eyebrow.textContent = "Workspace";
  title.textContent = "Coming Soon";
  subtitle.textContent = "This section has not been wired yet.";
}

function canAssignOrder(order) {
  return order.sourceStatus === "ready" || order.sourceStatus === "planned";
}

function getCarrierCompanyChoices() {
  const companiesById = new Map();

  for (const company of state.carrierCompanies) {
    companiesById.set(company.id, {
      id: company.id,
      name: company.name ?? company.legalName ?? company.id
    });
  }

  for (const driver of state.drivers) {
    if (driver.carrierCompanyId && !companiesById.has(driver.carrierCompanyId)) {
      companiesById.set(driver.carrierCompanyId, {
        id: driver.carrierCompanyId,
        name: driver.carrierCompanyName ?? driver.carrierCompanyId
      });
    }
  }

  return [...companiesById.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function getSelectedCarrierCompanyIdForOrder(order) {
  if (state.orderAssignmentFilters[order.id] !== undefined) {
    return state.orderAssignmentFilters[order.id];
  }

  const assignedDriver = state.drivers.find((driver) => driver.id === order.courierId);
  return assignedDriver?.carrierCompanyId ?? "";
}

function getAssignableDriversForOrder(order) {
  const selectedCarrierCompanyId = getSelectedCarrierCompanyIdForOrder(order);
  if (!selectedCarrierCompanyId) {
    return state.drivers;
  }

  return state.drivers.filter((driver) => driver.carrierCompanyId === selectedCarrierCompanyId);
}

function renderDriverAssignmentControl(order, context = "list") {
  const assignable = canAssignOrder(order);
  const carrierCompanies = getCarrierCompanyChoices();
  const selectedCarrierCompanyId = getSelectedCarrierCompanyIdForOrder(order);
  const assignableDrivers = getAssignableDriversForOrder(order);
  const disabled = !assignable || assignableDrivers.length === 0;
  const classes = context === "detail" ? "courier-assignment courier-assignment--detail" : "courier-assignment";

  return `
    <label class="${classes}">
      <span class="courier-assignment__label">${context === "detail" ? "Assigned Driver" : "Assign Driver"}</span>
      <div class="courier-assignment__controls">
        <select data-order-carrier-company="${order.id}" ${!assignable || carrierCompanies.length === 0 ? "disabled" : ""}>
          <option value="">${carrierCompanies.length === 0 ? "No carriers" : "Carrier company"}</option>
          ${carrierCompanies
            .map(
              (company) => `
                <option value="${company.id}" ${company.id === selectedCarrierCompanyId ? "selected" : ""}>${escapeHtml(company.name)}</option>
              `
            )
            .join("")}
        </select>
        <select data-order-assignment="${order.id}" ${disabled ? "disabled" : ""}>
          <option value="">${assignableDrivers.length === 0 ? "No drivers" : "Assign driver"}</option>
          ${assignableDrivers
          .map(
            (driver) => `
              <option value="${driver.id}" ${driver.id === order.courierId ? "selected" : ""}>${escapeHtml(driver.name)}</option>
            `
          )
          .join("")}
        </select>
      </div>
      <span class="courier-assignment__hint">${
        assignable ? "Pick a carrier company first if you want to filter the driver list." : "Only ready or planned orders can be reassigned."
      }</span>
    </label>
  `;
}

function renderAddressSnapshot(title, address) {
  const contactName = address?.contactName ?? "Not provided";
  const phone = address?.phone ?? "Not provided";
  const email = address?.email ?? "Not provided";
  const parcelSize = address?.parcelSize ?? "Not specified";
  const comment = address?.comment ?? "No comment";

  return `
    <section class="detail-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="detail-list">
        <div class="detail-row"><span>Contact</span><strong>${escapeHtml(contactName)}</strong></div>
        <div class="detail-row"><span>Address</span><strong>${escapeHtml(toAddressLabel(address))}</strong></div>
        <div class="detail-row"><span>Phone</span><strong>${escapeHtml(phone)}</strong></div>
        <div class="detail-row"><span>Email</span><strong>${escapeHtml(email)}</strong></div>
        <div class="detail-row"><span>Parcel Size</span><strong>${escapeHtml(parcelSize)}</strong></div>
        <div class="detail-row"><span>Comment</span><strong>${escapeHtml(comment)}</strong></div>
      </div>
    </section>
  `;
}

function renderOrdersView() {
  const visibleOrders = getVisibleOrders()
    .slice()
    .sort((left, right) => new Date(getOrderOperationalDate(left)).getTime() - new Date(getOrderOperationalDate(right)).getTime());
  const selectableOrders = visibleOrders.filter((order) => canOrderBePlanned(order));
  const selectedCount = getSelectedPlanningOrders().filter((order) => canOrderBePlanned(order)).length;

  return `
    <section class="stack">
      <div class="orders-selection-bar">
        <div class="orders-selection-bar__copy">
          <strong>VRP Selection</strong>
          <span>${selectedCount} selected on ${selectableOrders.length} eligible order(s) for ${escapeHtml(formatDateLabel(state.selectedDate))}</span>
        </div>
        <div class="orders-selection-bar__actions">
          <button class="ghost-button" type="button" data-action="select-visible-orders" ${selectableOrders.length === 0 ? "disabled" : ""}>Select Day</button>
          <button class="ghost-button" type="button" data-action="clear-visible-order-selection" ${selectedCount === 0 ? "disabled" : ""}>Clear</button>
          <button class="solid-button" type="button" data-action="open-selected-orders-in-optimizer" ${selectedCount === 0 ? "disabled" : ""}>Optimize with VRP</button>
        </div>
      </div>
      <div class="orders-list">
        ${visibleOrders.length > 0
          ? visibleOrders
          .map(
            (order) => `
              <article class="order-row ${order.id === state.selectedOrderId ? "order-row--active" : ""}">
                <label class="order-row__selector">
                  <input
                    type="checkbox"
                    data-planning-order-checkbox="${order.id}"
                    ${isOrderSelectedForPlanning(order.id) ? "checked" : ""}
                    ${!canOrderBePlanned(order) ? "disabled" : ""}
                  />
                </label>
                <button class="order-row__content" type="button" data-action="open-order-detail" data-order-id="${order.id}">
                  <span class="order-row__chevron">></span>
                  <span class="order-row__time">${escapeHtml(order.timeLabel)}</span>
                  <span class="order-row__status-block">
                    ${renderOrderExecutionStatus(order)}
                    ${
                      order.livePositionAt
                        ? `<span class="order-row__live">📍 Live ${escapeHtml(formatDateTimeLabel(order.livePositionAt))}</span>`
                        : ""
                    }
                  </span>
                  <span class="address-stack">
                    <span class="address-line">
                      <span class="address-line__icon">PU</span>
                      <span class="address-line__text">${escapeHtml(order.pickupLabel)}</span>
                    </span>
                    <span class="address-line">
                      <span class="address-line__icon">DO</span>
                      <span class="address-line__text">${escapeHtml(order.dropoffLabel)}</span>
                    </span>
                  </span>
                </button>
                ${renderDriverAssignmentControl(order)}
                <span class="price-stack">
                  <strong class="price-stack__value">${formatCurrency(order.amount)}</strong>
                  <span class="price-stack__meta">TTC</span>
                </span>
              </article>
            `
          )
          .join("")
          : `<div class="placeholder-card"><div><h3>No orders for ${escapeHtml(formatDateLabel(state.selectedDate))}</h3><p>Change the display date or create a new order for this day.</p></div></div>`}
      </div>
    </section>
  `;
}

function renderOrderDetail(order) {
  const primaryAction =
    order.routeId && order.routeState === "ready"
      ? `<button class="solid-button" type="button" data-action="dispatch-route" data-route-id="${order.routeId}">Dispatch Route</button>`
      : `<button class="solid-button" type="button" data-action="refresh">Refresh Data</button>`;
  const liveTrackingLabel = order.livePositionAt
    ? `Live ${formatDateTimeLabel(order.livePositionAt)}`
    : "No live position yet";
  const proofReason = order.statusReason || order.statusReasonLabel || "No incident reported";

  return `
    <article class="detail-card">
      <header class="detail-card__header">
        <div>
          <p class="eyebrow">Order ${escapeHtml(order.reference)}</p>
          <h3>${escapeHtml(order.dropoffLabel)}</h3>
        </div>
        ${renderOrderExecutionStatus(order)}
      </header>

      <div class="detail-grid">
        <section class="detail-section">
          <h4>Route Summary</h4>
          <div class="detail-list">
            <div class="detail-row"><span>Courier</span><strong>${escapeHtml(order.courier)}</strong></div>
            <div class="detail-row"><span>ETA block</span><strong>${escapeHtml(order.timeLabel)}</strong></div>
            <div class="detail-row"><span>Travel duration</span><strong>${escapeHtml(order.durationLabel)}</strong></div>
            <div class="detail-row"><span>Route status</span><strong>${escapeHtml(order.routeStatus)}</strong></div>
            <div class="detail-row"><span>Flow</span><strong>${escapeHtml(capitalize(order.kind))}</strong></div>
            <div class="detail-row"><span>Execution</span><strong>${escapeHtml(order.executionStatusLabel)}</strong></div>
            <div class="detail-row"><span>Live tracking</span><strong>${escapeHtml(liveTrackingLabel)}</strong></div>
          </div>
        </section>

        <section class="detail-section">
          <h4>Route Map</h4>
          ${buildMapEmbed([order.pickupAddress, order.dropoffAddress], `${order.reference} route map`, {
            livePosition: order.livePosition,
            liveLabel: order.courier === "Unassigned" ? "Driver live" : `${order.courier} live`
          })}
        </section>

        <section class="detail-section">
          <h4>Stop Timeline</h4>
          <div class="timeline">
            ${order.stops
              .map(
                (stop) => `
                  <div class="timeline__item">
                    <span class="timeline__dot"></span>
                    <div class="timeline__text">
                      <strong>${escapeHtml(stop.label)} - ${escapeHtml(stop.time)}</strong>
                      <span>${escapeHtml(stop.address)}${stop.statusLabel ? ` - ${escapeHtml(stop.statusLabel)}` : ""}</span>
                      ${stop.note ? `<span>${escapeHtml(stop.note)}</span>` : ""}
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </section>

        <section class="detail-section">
          <h4>Proof & Incident</h4>
          <div class="detail-list">
            <div class="detail-row"><span>Last proof</span><strong>${escapeHtml(order.lastProofOutcomeLabel ?? "Pending")}</strong></div>
            <div class="detail-row"><span>Reason</span><strong>${escapeHtml(proofReason)}</strong></div>
            <div class="detail-row"><span>Proof time</span><strong>${escapeHtml(order.lastProofDeliveredAt ? formatDateTimeLabel(order.lastProofDeliveredAt) : "Pending")}</strong></div>
          </div>
          ${
            order.proofPhotoUrls.length > 0
              ? `
                <div class="route-card__meta">
                  ${order.proofPhotoUrls
                    .slice(0, 3)
                    .map((photoUrl) => `<img class="vehicle-photo-thumb" src="${escapeHtml(photoUrl)}" alt="Proof" />`)
                    .join("")}
                </div>
              `
              : `<p class="empty-state">No proof photo attached yet.</p>`
          }
        </section>

        <section class="detail-section">
          <h4>Commercial Snapshot</h4>
          <div class="detail-list">
            <div class="detail-row"><span>Parcel Count</span><strong>${order.totals.parcelCount}</strong></div>
            <div class="detail-row"><span>Weight</span><strong>${order.totals.weightKg} kg</strong></div>
            <div class="detail-row"><span>Pricing Algo</span><strong>${escapeHtml(getAlgorithmLabel(order.pricingAlgorithmId ?? "basic"))}</strong></div>
            <div class="detail-row"><span>Total</span><strong>${formatCurrency(order.totals.revenue)}</strong></div>
            <div class="detail-row"><span>Operator Note</span><strong>${escapeHtml(order.notes)}</strong></div>
          </div>
          ${renderDriverAssignmentControl(order, "detail")}
          <div class="detail-actions">
            ${primaryAction}
            <button class="subtle-button" type="button" data-open-modal="order">Create Another Order</button>
          </div>
        </section>

        ${renderAddressSnapshot("Pickup Details", order.pickupAddress)}
        ${renderAddressSnapshot("Dropoff Details", order.dropoffAddress)}
      </div>
    </article>
  `;
}

function renderOrderDetailModal() {
  const content = document.querySelector("#order-detail-modal-content");
  if (!content) {
    return;
  }

  const selectedOrder = state.orders.find((order) => order.id === state.selectedOrderId);

  content.innerHTML = selectedOrder
    ? `
        <p class="eyebrow">Operations</p>
        <h3 class="modal__title">Order Detail</h3>
        <p class="modal__subtitle">Inspect the route, assignment, and commercial snapshot for this delivery.</p>
        ${renderOrderDetail(selectedOrder)}
      `
    : `
        <div class="placeholder-card"><div><h3>No order selected</h3><p>Pick an order from the list to inspect it here.</p></div></div>
      `;
}

function renderDriversView() {
  return `
    <section class="stack">
      <div class="drivers-list">
        ${state.drivers.length > 0
          ? state.drivers
              .map(
                (driver) => `
                  <button class="driver-row ${driver.id === state.selectedDriverId ? "driver-row--active" : ""}" type="button" data-action="open-driver-detail" data-driver-id="${driver.id}">
                    <span class="driver-avatar">${escapeHtml(initials(driver.name))}</span>
                    <span class="driver-row__main">
                      <span class="driver-row__title">
                        <strong>${escapeHtml(driver.name)}</strong>
                        <span class="status-chip" data-status="${driver.status}">${labelForStatus(driver.status)}</span>
                      </span>
                      <span class="emoji-meta">
                        <span class="emoji-chip">👤 ${escapeHtml(driver.name)}</span>
                        <span class="emoji-chip">✉️ ${escapeHtml(driver.email || "No email")}</span>
                        <span class="emoji-chip">📞 ${escapeHtml(driver.phone)}</span>
                        <span class="emoji-chip">🚚 ${escapeHtml(driver.vehicleTypeLabel)}</span>
                        <span class="emoji-chip">🏢 ${escapeHtml(driver.carrierCompanyName)}</span>
                        ${driver.tags.length > 0 ? driver.tags.map((tag) => `<span class="emoji-chip">${escapeHtml(tag)}</span>`).join("") : `<span class="emoji-chip">🏷️ No tags</span>`}
                      </span>
                    </span>
                    <span class="status-chip" data-status="${driver.status}">${driver.assignedRoutes} live</span>
                  </button>
                `
              )
              .join("")
          : `<div class="placeholder-card"><div><h3>No drivers yet</h3><p>Create the first driver profile to begin dispatching routes.</p></div></div>`}
      </div>
    </section>
  `;
}

function renderDriverDetail(driver) {
  const routes = state.routes.filter((route) => route.driverId === driver.id);

  return `
    <article class="detail-card">
      <header class="detail-card__header">
        <div>
          <p class="eyebrow">Driver</p>
          <h3>${escapeHtml(driver.name)}</h3>
        </div>
        <span class="status-chip" data-status="${driver.status}">${labelForStatus(driver.status)}</span>
      </header>

      <div class="detail-grid">
        <section class="detail-section">
          <h4>Profile</h4>
          <div class="detail-list">
            <div class="detail-row"><span>Email</span><strong>${escapeHtml(driver.email || "Not provided")}</strong></div>
            <div class="detail-row"><span>Phone</span><strong>${escapeHtml(driver.phone)}</strong></div>
            <div class="detail-row"><span>Vehicle</span><strong>${escapeHtml(driver.vehicleTypeLabel)}</strong></div>
            <div class="detail-row"><span>Carrier Company</span><strong>${escapeHtml(driver.carrierCompanyName)}</strong></div>
            <div class="detail-row"><span>Shift</span><strong>${escapeHtml(driver.shiftSummary)}</strong></div>
            <div class="detail-row"><span>Live Routes</span><strong>${driver.assignedRoutes}</strong></div>
            <div class="detail-row"><span>Completed Routes</span><strong>${driver.completedRoutes}</strong></div>
          </div>
        </section>

        <section class="detail-section">
          <h4>Skills</h4>
          <div class="route-card__meta">
            ${driver.tags.length > 0 ? driver.tags.map((tag) => `<span class="mini-chip">${escapeHtml(tag)}</span>`).join("") : `<span class="mini-chip">No skills tagged</span>`}
          </div>
        </section>

        <section class="detail-section">
          <h4>Route Queue</h4>
          ${routes.length > 0
            ? `
                <div class="route-list">
                  ${routes
                    .map(
                      (route) => `
                        <div class="route-card">
                          <div class="route-card__header">
                            <div>
                              <p class="route-card__title">${escapeHtml(route.id)}</p>
                              <div class="route-card__meta">
                                <span>${route.stops.length} stops</span>
                                <span>${Math.round((route.totalDurationSeconds ?? 0) / 60)} min</span>
                              </div>
                            </div>
                            <span class="status-chip" data-status="${normalizeBackendStatus(route.status)}">${capitalize(route.status)}</span>
                          </div>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              `
            : `<p class="empty-state">No routes assigned yet.</p>`}
        </section>

        <section class="detail-section">
          <h4>Driver Notes</h4>
          <p>${escapeHtml(driver.currentNotes)}</p>
          ${
            driver.vehiclePhotoUrls.length > 0
              ? `
                <div class="route-card__meta">
                  ${driver.vehiclePhotoUrls
                    .slice(0, 3)
                    .map((photoUrl) => `<img class="vehicle-photo-thumb" src="${escapeHtml(photoUrl)}" alt="Vehicle" />`)
                    .join("")}
                </div>
              `
              : ""
          }
          <div class="detail-actions">
            <button class="ghost-button" type="button" data-action="edit-driver" data-driver-id="${driver.id}">Edit Driver</button>
            <button class="solid-button" type="button" data-action="open-create-driver">Add Another Driver</button>
            <button class="subtle-button" type="button" data-action="refresh">Refresh Fleet</button>
          </div>
        </section>
      </div>
    </article>
  `;
}

function renderDriverDetailModal() {
  const content = document.querySelector("#driver-detail-modal-content");
  if (!content) {
    return;
  }

  const selectedDriver = state.drivers.find((driver) => driver.id === state.selectedDriverId);

  content.innerHTML = selectedDriver
    ? `
        <p class="eyebrow">Fleet</p>
        <h3 class="modal__title">Driver Detail</h3>
        <p class="modal__subtitle">Inspect the driver profile, live routes, and assigned operational capacity.</p>
        ${renderDriverDetail(selectedDriver)}
      `
    : `
        <div class="placeholder-card"><div><h3>No driver selected</h3><p>Pick a driver from the list to inspect it here.</p></div></div>
      `;
}

function renderCustomersView() {
  const customers = getVisibleCustomers();

  return `
    <section class="stack">
      <div class="section-inline-actions">
        <button class="solid-button" type="button" data-action="open-create-customer">Create Customer</button>
      </div>
      <div class="drivers-list">
        ${customers.length > 0
          ? customers
              .map(
                (customer) => `
                  <button class="driver-row ${customer.id === state.selectedCustomerId ? "driver-row--active" : ""}" type="button" data-action="open-customer-detail" data-customer-id="${customer.id}">
                    <span class="driver-avatar">${escapeHtml(initials(customer.name))}</span>
                    <span class="driver-row__main">
                      <span class="driver-row__title">
                        <strong>${escapeHtml(customer.name)}</strong>
                        <span class="status-chip" data-status="${customer.status}">${customer.liveOrders} live</span>
                      </span>
                      <span class="emoji-meta">
                        <span class="emoji-chip">🏢 ${escapeHtml(customer.merchantId)}</span>
                        <span class="emoji-chip">📍 ${escapeHtml(customer.city)}</span>
                        <span class="emoji-chip">📦 ${customer.orderCount} orders</span>
                        <span class="emoji-chip">🚚 ${escapeHtml(customer.preferredCourier)}</span>
                        <span class="emoji-chip">⚙️ ${escapeHtml(getAlgorithmLabel(customer.pricingAlgorithmId ?? "basic"))}</span>
                        ${customer.tags.length > 0 ? customer.tags.map((tag) => `<span class="emoji-chip">${escapeHtml(tag)}</span>`).join("") : `<span class="emoji-chip">🏷️ Standard</span>`}
                      </span>
                    </span>
                    <span class="price-stack">
                      <strong class="price-stack__value">${formatCurrency(customer.totalRevenue)}</strong>
                      <span class="price-stack__meta">Revenue</span>
                    </span>
                  </button>
                `
              )
              .join("")
          : `<div class="placeholder-card"><div><h3>No customers for ${escapeHtml(formatDateLabel(state.selectedDate))}</h3><p>Create or import orders on this day to populate the customer directory.</p></div></div>`}
      </div>
    </section>
  `;
}

function renderCustomerDetail(customer) {
  return `
    <article class="detail-card">
      <header class="detail-card__header">
        <div>
          <p class="eyebrow">Customer</p>
          <h3>${escapeHtml(customer.name)}</h3>
        </div>
        <span class="status-chip" data-status="${customer.status}">${capitalize(customer.status)}</span>
      </header>

      <div class="detail-grid">
        <section class="detail-section">
          <h4>Account Snapshot</h4>
          <div class="detail-list">
            <div class="detail-row"><span>Merchant</span><strong>${escapeHtml(customer.merchantId)}</strong></div>
            <div class="detail-row"><span>Main Address</span><strong>${escapeHtml(customer.addressLabel)}</strong></div>
            <div class="detail-row"><span>Contact</span><strong>${escapeHtml(customer.contactName || "Not provided")}</strong></div>
            <div class="detail-row"><span>Contact Email</span><strong>${escapeHtml(customer.contactEmail || "Not provided")}</strong></div>
            <div class="detail-row"><span>VAT</span><strong>${escapeHtml(customer.vatNumber || "Not provided")}</strong></div>
            <div class="detail-row"><span>Total Orders</span><strong>${customer.orderCount}</strong></div>
            <div class="detail-row"><span>Preferred Courier</span><strong>${escapeHtml(customer.preferredCourier)}</strong></div>
            <div class="detail-row"><span>Default Algo</span><strong>${escapeHtml(getAlgorithmLabel(customer.pricingAlgorithmId ?? "basic"))}</strong></div>
            <div class="detail-row"><span>Revenue</span><strong>${formatCurrency(customer.totalRevenue)}</strong></div>
          </div>

          <div class="detail-actions">
            <button class="ghost-button" type="button" data-action="edit-customer" data-customer-id="${customer.id}">Edit Customer</button>
            <select id="customer-pricing-algo-select">
              ${ADMIN_PRICING_ALGOS.map(
                (algo) => `<option value="${algo.id}" ${algo.id === (customer.pricingAlgorithmId ?? "basic") ? "selected" : ""}>${escapeHtml(algo.title)}</option>`
              ).join("")}
            </select>
            <button class="subtle-button" type="button" data-action="save-customer-pricing-algo" data-customer-id="${customer.id}">Save Default Algo</button>
          </div>
        </section>

        <section class="detail-section">
          <h4>Service Tags</h4>
          <div class="route-card__meta">
            ${customer.tags.length > 0 ? customer.tags.map((tag) => `<span class="mini-chip">${escapeHtml(tag)}</span>`).join("") : `<span class="mini-chip">Standard account</span>`}
          </div>
        </section>

        <section class="detail-section">
          <h4>Recent Orders</h4>
          <div class="route-list">
            ${customer.orders.length > 0
              ? customer.orders
              .slice()
              .sort((left, right) => new Date(right.updatedAt ?? right.createdAt).getTime() - new Date(left.updatedAt ?? left.createdAt).getTime())
              .slice(0, 5)
              .map(
                (order) => `
                  <div class="route-card">
                    <div class="route-card__header">
                      <div>
                        <p class="route-card__title">${escapeHtml(order.reference)}</p>
                        <div class="route-card__meta">
                          <span>${escapeHtml(order.dropoffLabel)}</span>
                          <span>${escapeHtml(order.timeLabel)}</span>
                          <span>${escapeHtml(order.courier)}</span>
                        </div>
                      </div>
                      <span class="status-chip" data-status="${order.status}">${labelForStatus(order.status)}</span>
                    </div>
                  </div>
                `
              )
              .join("")
              : `<p class="empty-state">No orders yet for this account.</p>`}
          </div>
        </section>

        <section class="detail-section">
          <h4>Quotes</h4>
          <div class="route-list">
            ${(customer.quotes ?? []).length > 0
              ? customer.quotes
                  .map(
                    (quote) => `
                      <div class="route-card">
                        <div class="route-card__header">
                          <div>
                            <p class="route-card__title">${escapeHtml(quote.sourceLabel ?? capitalize(quote.source))}</p>
                            <div class="route-card__meta">
                              <span>${escapeHtml(quote.dateKey ?? state.selectedDate)}</span>
                              <span>${escapeHtml(quote.description ?? "")}</span>
                            </div>
                          </div>
                          <span class="price-stack__value">${formatCurrency(quote.amount ?? 0)}</span>
                        </div>
                      </div>
                    `
                  )
                  .join("")
              : `<p class="empty-state">No quotes yet for this customer.</p>`}
          </div>
        </section>
      </div>
    </article>
  `;
}

function renderCustomerDetailModal() {
  const content = document.querySelector("#customer-detail-modal-content");
  if (!content) {
    return;
  }

  const selectedCustomer = getVisibleCustomers().find((customer) => customer.id === state.selectedCustomerId);

  content.innerHTML = selectedCustomer
    ? `
        <p class="eyebrow">Customers</p>
        <h3 class="modal__title">Customer Detail</h3>
        <p class="modal__subtitle">Inspect the account profile, delivery activity, and service tags for this customer.</p>
        ${renderCustomerDetail(selectedCustomer)}
      `
    : `
        <div class="placeholder-card"><div><h3>No customer selected</h3><p>Pick a customer from the list to inspect it here.</p></div></div>
      `;
}

function getInboxThreads(audience = state.selectedInboxAudience) {
  if (audience === "drivers") {
    return state.drivers.map((driver) => {
      const baseMessages = [
        {
          id: `${driver.id}_1`,
          author: driver.name,
          body: driver.activeRouteId ? `Route ${driver.activeRouteId} is active. ${driver.currentNotes}.` : "Ready to take a new route when needed.",
          time: driver.shiftSummary?.split(" - ")[0] ?? "08h00",
          mine: false
        },
        {
          id: `${driver.id}_2`,
          author: "Naaval Ops",
          body: driver.activeRouteId ? "Keep the POD updated after each stop." : "Stand by for the next dispatch wave.",
          time: "09h15",
          mine: true
        }
      ];
      const extraMessages = state.inboxMessages
        .filter((message) => message.audience === "drivers" && message.threadId === driver.id)
        .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
        .map((message) => ({
          id: message.id,
          author: message.author,
          body: message.body,
          time: message.time,
          mine: message.senderType ? message.senderType === "ops" : Boolean(message.mine)
        }));
      const messages = extraMessages.length > 0 ? extraMessages : baseMessages;

      return {
        id: driver.id,
        audience: "drivers",
        name: driver.name,
        subtitle: `${driver.vehicleTypeLabel} - ${driver.carrierCompanyName}`,
        preview: messages.at(-1)?.body ?? "",
        unreadCount: driver.activeRouteId ? 1 : 0,
        messages
      };
    });
  }

  return getVisibleCustomers().map((customer) => {
    const lastOrder = customer.orders?.[0];
    const baseMessages = [
      {
        id: `${customer.id}_1`,
        author: customer.name,
        body: lastOrder ? `Can you confirm the ETA for ${lastOrder.reference}?` : "Hello, I would like a delivery update.",
        time: lastOrder?.timeLabel ?? "08h30",
        mine: false
      },
      {
        id: `${customer.id}_2`,
        author: "Naaval Ops",
        body: lastOrder
          ? `Your route is currently ${labelForStatus(lastOrder.status).toLowerCase()}. Default pricing algo: ${getAlgorithmLabel(customer.pricingAlgorithmId ?? "basic")}.`
          : "We are reviewing the best slot and service level for you.",
        time: "09h10",
        mine: true
      }
    ];
    const extraMessages = state.inboxMessages
      .filter((message) => message.audience === "customers" && message.threadId === customer.id)
      .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
      .map((message) => ({
        id: message.id,
        author: message.author,
        body: message.body,
        time: message.time,
        mine: message.senderType ? message.senderType === "ops" : Boolean(message.mine)
      }));
    const messages = extraMessages.length > 0 ? extraMessages : baseMessages;

    return {
      id: customer.id,
      audience: "customers",
      name: customer.name,
      subtitle: customer.contactEmail || customer.addressLabel,
      preview: messages.at(-1)?.body ?? "",
      unreadCount: customer.liveOrders > 0 ? 1 : 0,
      messages
    };
  });
}

function renderInboxView() {
  const threads = getInboxThreads(state.selectedInboxAudience);
  const selectedThread = threads.find((thread) => thread.id === state.selectedInboxThreadId) ?? threads[0] ?? null;

  return `
    <div class="inbox-layout">
      <section class="inbox-sidebar">
        <div class="pricing-pillbar pricing-pillbar--inbox">
          <button class="pricing-pill ${state.selectedInboxAudience === "customers" ? "pricing-pill--active" : ""}" type="button" data-action="set-inbox-audience" data-inbox-audience="customers">Customers</button>
          <button class="pricing-pill ${state.selectedInboxAudience === "drivers" ? "pricing-pill--active" : ""}" type="button" data-action="set-inbox-audience" data-inbox-audience="drivers">Drivers</button>
        </div>

        <div class="inbox-thread-list">
          ${threads.length > 0
            ? threads
                .map(
                  (thread) => `
                    <button class="inbox-thread ${thread.id === selectedThread?.id ? "inbox-thread--active" : ""}" type="button" data-action="open-inbox-thread" data-thread-id="${thread.id}">
                      <span class="driver-avatar">${escapeHtml(initials(thread.name))}</span>
                      <span class="inbox-thread__copy">
                        <strong>${escapeHtml(thread.name)}</strong>
                        <span>${escapeHtml(thread.subtitle)}</span>
                        <small>${escapeHtml(thread.preview)}</small>
                      </span>
                      ${thread.unreadCount > 0 ? `<span class="mini-chip">${thread.unreadCount}</span>` : ""}
                    </button>
                  `
                )
                .join("")
            : `<div class="placeholder-card"><div><h3>No conversations yet</h3><p>The messaging inbox will populate as soon as customer or driver activity appears.</p></div></div>`}
        </div>
      </section>

      <section class="inbox-conversation">
        ${selectedThread
          ? `
            <header class="inbox-conversation__header">
              <div>
                <h3>${escapeHtml(selectedThread.name)}</h3>
                <p class="panel__subtitle">${escapeHtml(selectedThread.subtitle)}</p>
              </div>
            </header>
            <div class="inbox-messages">
              ${selectedThread.messages
                .map(
                  (message) => `
                    <article class="inbox-message ${message.mine ? "inbox-message--mine" : ""}">
                      <strong>${escapeHtml(message.author)}</strong>
                      <p>${escapeHtml(message.body)}</p>
                      <span>${escapeHtml(message.time)}</span>
                    </article>
                  `
                )
                .join("")}
            </div>
            <form id="inbox-reply-form" class="inbox-composer">
              <input type="hidden" name="threadId" value="${escapeHtml(selectedThread.id)}" />
              <input type="hidden" name="audience" value="${escapeHtml(selectedThread.audience)}" />
              <label class="inbox-composer__field">
                <textarea name="body" rows="2" placeholder="Write a reply..." required></textarea>
              </label>
              <button class="solid-button" type="submit">Send</button>
            </form>
          `
          : `<div class="placeholder-card"><div><h3>Select a conversation</h3><p>Pick a customer or driver thread from the left to open the chat.</p></div></div>`}
      </section>
    </div>
  `;
}

function renderRecurringRoutesView() {
  const recurringRoutes = getVisibleRecurringRoutes();

  return `
    <section class="stack">
      <div class="detail-actions">
        <button class="solid-button" type="button" data-open-modal="recurring-route">Create Recurring Delivery</button>
      </div>
      <div class="drivers-list">
        ${recurringRoutes.length > 0
          ? recurringRoutes
              .map(
                (route) => `
                  <article class="recurring-row-shell ${route.id === state.selectedRecurringRouteId ? "recurring-row-shell--active" : ""}">
                    <button class="driver-row recurring-row" type="button" data-action="open-recurring-route-detail" data-recurring-route-id="${route.id}">
                      <span class="driver-avatar">🔁</span>
                      <span class="driver-row__main">
                        <span class="driver-row__title">
                          <strong>${escapeHtml(route.label)}</strong>
                          <span class="status-chip" data-status="${route.status}">${capitalize(route.status)}</span>
                        </span>
                        <span class="emoji-meta">
                          <span class="emoji-chip">📅 ${escapeHtml(route.frequency)}</span>
                          <span class="emoji-chip">⏱️ ${escapeHtml(route.windowLabel)}</span>
                          <span class="emoji-chip">🚚 ${escapeHtml(route.vehicleLabel)}</span>
                          <span class="emoji-chip">👤 ${escapeHtml(route.driverName)}</span>
                          <span class="emoji-chip">📦 ${route.stopCount} stops</span>
                          <span class="emoji-chip">🏢 ${route.customerCount} customers</span>
                        </span>
                      </span>
                      <span class="price-stack">
                        <strong class="price-stack__value">${escapeHtml(route.nextRunLabel)}</strong>
                        <span class="price-stack__meta">Next run</span>
                      </span>
                    </button>
                    <button class="ghost-button recurring-row__delete" type="button" data-action="delete-recurring-route" data-recurring-route-id="${route.id}">Delete</button>
                  </article>
                `
              )
              .join("")
          : `<div class="placeholder-card"><div><h3>No recurring routes for ${escapeHtml(formatDateLabel(state.selectedDate))}</h3><p>Add more repeated customer activity to generate recurring route templates.</p></div></div>`}
      </div>
    </section>
  `;
}

function renderRecurringRouteDetail(route) {
  return `
    <article class="detail-card">
      <header class="detail-card__header">
        <div>
          <p class="eyebrow">Recurring Route</p>
          <h3>${escapeHtml(route.label)}</h3>
        </div>
        <span class="status-chip" data-status="${route.status}">${capitalize(route.status)}</span>
      </header>

      <div class="detail-grid">
        <section class="detail-section">
          <h4>Template Summary</h4>
          <div class="detail-list">
            <div class="detail-row"><span>Frequency</span><strong>${escapeHtml(route.frequency)}</strong></div>
            <div class="detail-row"><span>Pickup time</span><strong>${escapeHtml(route.windowLabel)}</strong></div>
            <div class="detail-row"><span>Hub</span><strong>${escapeHtml(route.hubLabel)}</strong></div>
            <div class="detail-row"><span>Driver</span><strong>${escapeHtml(route.driverName)}</strong></div>
            <div class="detail-row"><span>Vehicle</span><strong>${escapeHtml(route.vehicleLabel)}</strong></div>
            <div class="detail-row"><span>Stops</span><strong>${route.stopCount}</strong></div>
            <div class="detail-row"><span>Customers</span><strong>${route.customerCount}</strong></div>
          </div>
        </section>

        <section class="detail-section">
          <h4>Operational Tags</h4>
          <div class="route-card__meta">
            ${route.tags.map((tag) => `<span class="mini-chip">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </section>

        <section class="detail-section">
          <h4>Included Orders</h4>
          <div class="route-list">
            ${route.orders
              .map(
                (order) => `
                  <div class="route-card">
                    <div class="route-card__header">
                      <div>
                        <p class="route-card__title">${escapeHtml(order.reference)}</p>
                        <div class="route-card__meta">
                          <span>${escapeHtml(order.dropoffLabel)}</span>
                          <span>${escapeHtml(order.timeLabel)}</span>
                        </div>
                      </div>
                      <span class="status-chip" data-status="${order.status}">${labelForStatus(order.status)}</span>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </section>

        <section class="detail-section">
          <h4>Planner Note</h4>
          <p>${escapeHtml(route.note)}</p>
        </section>
      </div>

      <div class="detail-actions">
        <button class="ghost-button" type="button" data-action="delete-recurring-route" data-recurring-route-id="${route.id}">Delete Recurring Delivery</button>
      </div>
    </article>
  `;
}

function renderRecurringRouteDetailModal() {
  const content = document.querySelector("#recurring-route-detail-modal-content");
  if (!content) {
    return;
  }

  const selectedRoute = getVisibleRecurringRoutes().find((route) => route.id === state.selectedRecurringRouteId);

  content.innerHTML = selectedRoute
    ? `
        <p class="eyebrow">Planning</p>
        <h3 class="modal__title">Recurring Route Detail</h3>
        <p class="modal__subtitle">Inspect the recurring route template, assigned capacity, and covered orders.</p>
        ${renderRecurringRouteDetail(selectedRoute)}
      `
    : `
        <div class="placeholder-card"><div><h3>No recurring route selected</h3><p>Pick a recurring route from the list to inspect it here.</p></div></div>
      `;
}

function renderOptimizerStageTabs() {
  const stages = [
    { id: "history", index: "00", label: "History", hint: "Compare routings" },
    { id: "setup", index: "01", label: "Setup", hint: "Configure wave" },
    { id: "orders", index: "02", label: "Orders", hint: "Review demand" },
    { id: "map", index: "03", label: "Map", hint: "Inspect clusters" },
    { id: "routes", index: "04", label: "Routes", hint: "Dispatch draft" }
  ];

  return `
    <div class="optimizer-stagebar">
      ${stages
        .map(
          (stage) => `
            <button class="optimizer-stagebar__item ${state.activeOptimizerStage === stage.id ? "optimizer-stagebar__item--active" : ""}" type="button" data-action="set-optimizer-stage" data-optimizer-stage="${stage.id}">
              <span class="optimizer-stagebar__index">${escapeHtml(stage.index)}</span>
              <span class="optimizer-stagebar__copy">
                <strong>${escapeHtml(stage.label)}</strong>
                <small>${escapeHtml(stage.hint)}</small>
              </span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function getOptimizerSelectedRoute(visibleRoutes) {
  return visibleRoutes.find((route) => route.id === state.selectedOptimizerRouteId) ?? visibleRoutes[0] ?? null;
}

function buildOptimizerRouteContext(route) {
  if (!route) {
    return {
      route: null,
      driver: null,
      shift: null,
      routeOrders: [],
      mapAddresses: []
    };
  }

  const driver = state.drivers.find((candidate) => candidate.id === route.driverId) ?? null;
  const shift = state.shifts.find((candidate) => candidate.id === route.shiftId || candidate.driverId === route.driverId) ?? null;
  const orderIds = [...new Set((route.stops ?? []).flatMap((stop) => getStopOrderIds(stop)).filter(Boolean))];
  const routeOrders = orderIds
    .map((orderId) => state.orders.find((candidate) => candidate.id === orderId))
    .filter(Boolean);

  return {
    route,
    driver,
    shift,
    routeOrders,
    mapAddresses: route.stops?.map((stop) => stop.address).filter(Boolean) ?? []
  };
}

function formatOptimizerRouteLabel(routeId) {
  const value = String(routeId ?? "route");
  if (value.startsWith("route_")) {
    const suffix = value.split("_").at(-1) ?? value.slice(-6);
    return `RT-${suffix.toUpperCase()}`;
  }
  return value.toUpperCase();
}

function formatOptimizerSetupDate(dateKey) {
  const value = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(value.getTime())) {
    return dateKey;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(value);
}

function formatOptimizerTimeValue(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "--H--";
  }

  const [hours = "00", minutes = "00"] = normalized.split(":");
  return `${hours.padStart(2, "0")}H${minutes.padStart(2, "0")}`;
}

function getOptimizerObjectivePreset() {
  if (state.optimizerSetup.formula === "completion_time") {
    return "speed";
  }

  if (state.optimizerSetup.formula === "distance") {
    return "distance";
  }

  return "balanced";
}

function getOptimizerPlanningJobs() {
  return [...state.planningJobs].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

function getSelectedPlanningJob(planningJobs = getOptimizerPlanningJobs()) {
  return planningJobs.find((job) => job.id === state.selectedPlanningJobId) ?? planningJobs[0] ?? null;
}

function getPlanRoutes(planId) {
  return state.routes.filter((route) => route.planId === planId);
}

function getPlanOrders(plan) {
  if (!plan) {
    return [];
  }

  const orderIds = new Set(plan.orderIds ?? []);
  return state.orders.filter((order) => orderIds.has(order.id));
}

function getPlanningJobDisplayName(plan, index = 0) {
  return `Routing ${String(index + 1).padStart(2, "0")}`;
}

function getPlanningJobStats(plan) {
  const routes = getPlanRoutes(plan?.id);
  const orders = getPlanOrders(plan);
  const totalDistanceMeters = routes.reduce((sum, route) => sum + (route.totalDistanceMeters ?? 0), 0);
  const totalDurationSeconds = routes.reduce((sum, route) => sum + (route.totalDurationSeconds ?? 0), 0);
  const revenue = orders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const driverCount = new Set(routes.map((route) => route.driverId).filter(Boolean)).size;
  const stopCount = routes.reduce((sum, route) => sum + (route.stops?.length ?? 0), 0);

  return {
    routes,
    orders,
    driverCount,
    stopCount,
    routeCount: routes.length,
    orderCount: orders.length,
    totalDistanceKm: Math.max(0, Math.round(totalDistanceMeters / 1000)),
    totalDurationLabel: formatDurationMinutes(totalDurationSeconds),
    revenueLabel: formatCurrency(revenue)
  };
}

function splitContactName(fullName) {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      firstName: "",
      lastName: ""
    };
  }

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: ""
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function updateOptimizerSetupField(field, value) {
  if (field === "date") {
    state.selectedDate = value || state.selectedDate;
    ensureSelections();
    return;
  }

  if (field === "trucks" || field === "handlingMinutes" || field === "pickupLandingMinutes") {
    state.optimizerSetup[field] = Number.parseInt(value, 10) || 0;
    return;
  }

  state.optimizerSetup[field] = value;
}

function renderOptimizerOrdersTable(orders, emptyCopy) {
  return `
    <div class="optimizer-table-wrap">
      <table class="optimizer-table optimizer-table--dense">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Pickup</th>
            <th>Dropoff</th>
            <th>Contact</th>
            <th>Size</th>
            <th>Window</th>
            <th>Algo</th>
            <th>Status</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          ${orders.length > 0
            ? orders
                .map(
                  (order) => `
                    <tr>
                      <td>
                        <div class="optimizer-cell-stack">
                          <strong>${escapeHtml(order.reference)}</strong>
                          <span>${escapeHtml(order.merchantId ?? "merchant_demo")}</span>
                        </div>
                      </td>
                      <td>
                        <div class="optimizer-cell-stack">
                          <strong>${escapeHtml(order.pickupLabel)}</strong>
                          <span>${escapeHtml(order.pickupAddress?.city ?? "")}</span>
                        </div>
                      </td>
                      <td>
                        <div class="optimizer-cell-stack">
                          <strong>${escapeHtml(order.dropoffLabel)}</strong>
                          <span>${escapeHtml(order.dropoffAddress?.city ?? "")}</span>
                        </div>
                      </td>
                      <td>${escapeHtml(order.dropoffAddress?.contactName ?? order.pickupAddress?.contactName ?? "Pending contact")}</td>
                      <td><span class="optimizer-stop-pill">${escapeHtml(order.parcelSize ?? "M")}</span></td>
                      <td>${escapeHtml(order.timeLabel)}</td>
                      <td><span class="mini-chip">${escapeHtml(getAlgorithmLabel(order.pricingAlgorithmId ?? "basic"))}</span></td>
                      <td>${renderStatusStack(order.status, order.statusProgressLabel)}</td>
                      <td><strong>${formatCurrency(order.amount)}</strong></td>
                    </tr>
                  `
                )
                .join("")
            : `<tr><td colspan="9">${escapeHtml(emptyCopy)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function getOptimizerSpreadsheetColumns() {
  return [
    { id: "lastName", fallbackLabel: "Name" },
    { id: "firstName", fallbackLabel: "First Name" },
    { id: "companyName", fallbackLabel: "Company Name" },
    { id: "streetName", fallbackLabel: "Street Name" },
    { id: "postCode", fallbackLabel: "Post Code" },
    { id: "city", fallbackLabel: "City" },
    { id: "country", fallbackLabel: "Country" },
    { id: "phone", fallbackLabel: "Phone" },
    { id: "mail", fallbackLabel: "Mail" },
    { id: "parcelSize", fallbackLabel: "Parcel Size" },
    { id: "comment", fallbackLabel: "Comment" }
  ];
}

function getOptimizerSpreadsheetCellValue(order, columnId) {
  const contact = splitContactName(order.dropoffAddress?.contactName ?? order.pickupAddress?.contactName ?? "");
  switch (columnId) {
    case "lastName":
      return contact.lastName || "";
    case "firstName":
      return contact.firstName || "";
    case "companyName":
      return order.dropoffLabel || order.dropoffAddress?.label || order.merchantId || "";
    case "streetName":
      return order.dropoffAddress?.street1 || "";
    case "postCode":
      return order.dropoffAddress?.postalCode || "";
    case "city":
      return order.dropoffAddress?.city || "";
    case "country":
      return order.dropoffAddress?.countryCode || "";
    case "phone":
      return order.dropoffAddress?.phone || "";
    case "mail":
      return order.dropoffAddress?.email || "";
    case "parcelSize":
      return order.parcelSize || "M";
    case "comment":
      return order.notes || order.dropoffAddress?.comment || "";
    default:
      return "";
  }
}

function buildUpdatedOrderFromSpreadsheetCell(order, columnId, rawValue) {
  const value = String(rawValue ?? "").trim();
  const updatedOrder = clone(order);
  updatedOrder.dropoffAddress = clone(order.dropoffAddress ?? {});
  updatedOrder.pickupAddress = clone(order.pickupAddress ?? {});

  const currentContact = splitContactName(updatedOrder.dropoffAddress?.contactName ?? updatedOrder.pickupAddress?.contactName ?? "");
  const firstName = columnId === "firstName" ? value : currentContact.firstName || "";
  const lastName = columnId === "lastName" ? value : currentContact.lastName || "";
  const contactName = [firstName, lastName].filter(Boolean).join(" ").trim();

  switch (columnId) {
    case "firstName":
    case "lastName":
      updatedOrder.dropoffAddress.contactName = contactName;
      break;
    case "companyName":
      updatedOrder.dropoffLabel = value;
      updatedOrder.dropoffAddress.label = value;
      break;
    case "streetName":
      updatedOrder.dropoffAddress.street1 = value;
      break;
    case "postCode":
      updatedOrder.dropoffAddress.postalCode = value;
      break;
    case "city":
      updatedOrder.dropoffAddress.city = value;
      break;
    case "country":
      updatedOrder.dropoffAddress.countryCode = value || "FR";
      break;
    case "phone":
      updatedOrder.dropoffAddress.phone = value;
      break;
    case "mail":
      updatedOrder.dropoffAddress.email = value;
      break;
    case "parcelSize":
      updatedOrder.parcelSize = value || "M";
      updatedOrder.dropoffAddress.parcelSize = value || "M";
      break;
    case "comment":
      updatedOrder.notes = value;
      updatedOrder.dropoffAddress.comment = value;
      break;
    default:
      break;
  }

  return updatedOrder;
}

function mergeOrderForUi(previousOrder, savedOrder) {
  const nextOrder = {
    ...previousOrder,
    ...savedOrder,
    pickupAddress: clone(savedOrder.pickupAddress ?? previousOrder.pickupAddress ?? null),
    dropoffAddress: clone(savedOrder.dropoffAddress ?? previousOrder.dropoffAddress ?? null),
    requiredSkills: clone(savedOrder.requiredSkills ?? previousOrder.requiredSkills ?? []),
    proofPhotoUrls: clone(savedOrder.lastProofPhotoUrls ?? previousOrder.proofPhotoUrls ?? []),
    pickupLabel: savedOrder.pickupAddress ? toAddressLabel(savedOrder.pickupAddress) : previousOrder.pickupLabel,
    dropoffLabel: toAddressLabel(savedOrder.dropoffAddress ?? previousOrder.dropoffAddress),
    notes: savedOrder.notes ?? previousOrder.notes
  };

  return nextOrder;
}

function replaceOrderInState(savedOrder) {
  state.orders = state.orders.map((order) => (order.id === savedOrder.id ? mergeOrderForUi(order, savedOrder) : order));
  if (localDb?.orders) {
    localDb.orders = localDb.orders.map((order) => (order.id === savedOrder.id ? clone(savedOrder) : order));
  }
}

async function updateOptimizerSpreadsheetCell(orderId, columnId, value) {
  const sourceOrder = state.orders.find((order) => order.id === orderId);
  if (!sourceOrder) {
    showToast("Order not found in optimizer sheet.", "error");
    return;
  }

  const updatedOrder = buildUpdatedOrderFromSpreadsheetCell(sourceOrder, columnId, value);
  replaceOrderInState(updatedOrder);
  render();

  if (!state.apiAvailable) {
    return;
  }

  try {
    const savedOrder = await patchJson(`/orders/${orderId}`, updatedOrder);
    replaceOrderInState(savedOrder);
    render();
  } catch (error) {
    replaceOrderInState(sourceOrder);
    render();
    showToast(`Unable to update VRP data: ${error.message}`, "error");
  }
}

function renderOptimizerSpreadsheetTable(orders, emptyCopy) {
  const columns = getOptimizerSpreadsheetColumns();
  return `
    <div class="optimizer-spreadsheet-shell">
      <table class="optimizer-spreadsheet">
        <thead>
          <tr>
            ${columns
              .map(
                (column) => `
                  <th>
                    <input class="optimizer-spreadsheet__header-input" type="text" value="${escapeHtml(state.optimizerSpreadsheetHeaders[column.id] || column.fallbackLabel)}" data-optimizer-header="${column.id}" />
                  </th>
                `
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${orders.length > 0
            ? orders
                .map((order) => {
                  return `
                    <tr>
                      ${columns
                        .map(
                          (column) => `
                            <td>
                              <input
                                class="optimizer-spreadsheet__cell-input"
                                type="text"
                                value="${escapeHtml(getOptimizerSpreadsheetCellValue(order, column.id))}"
                                data-optimizer-cell="${column.id}"
                                data-order-id="${order.id}"
                              />
                            </td>
                          `
                        )
                        .join("")}
                    </tr>
                  `;
                })
                .join("")
            : `<tr><td colspan="11">${escapeHtml(emptyCopy)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderOptimizerClusterMap(orders, title = "VRP cluster map") {
  const addresses = orders
    .flatMap((order) => [order.pickupAddress, order.dropoffAddress])
    .filter((address) => Number.isFinite(address?.coordinates?.lat) && Number.isFinite(address?.coordinates?.lon));

  if (addresses.length === 0) {
    return `<div class="route-map route-map--empty"><div><strong>Map setup pending</strong><p>Add coordinates to imported orders to display the cluster map.</p></div></div>`;
  }

  const points = addresses.map((address) => address.coordinates);
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latRange = Math.max(0.0001, maxLat - minLat);
  const lonRange = Math.max(0.0001, maxLon - minLon);
  const padding = 0.02;
  const bbox = [minLon - padding, minLat - padding, maxLon + padding, maxLat + padding].join(",");
  const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik`;
  const palette = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#84cc16", "#06b6d4", "#f97316"];

  const pins = points
    .map((point, index) => {
      const x = 6 + ((point.lon - minLon) / lonRange) * 88;
      const y = 8 + (1 - (point.lat - minLat) / latRange) * 80;
      const jitterX = ((index % 4) - 1.5) * 0.6;
      const jitterY = ((index % 3) - 1) * 0.7;
      return {
        left: Math.min(95, Math.max(5, x + jitterX)),
        top: Math.min(92, Math.max(6, y + jitterY)),
        color: palette[index % palette.length]
      };
    })
    .map(
      (pin) => `
        <span class="route-map__pin" style="left:${pin.left}%; top:${pin.top}%; --pin-color:${pin.color};" aria-hidden="true"></span>
      `
    )
    .join("");

  return `
    <div class="route-map route-map--embed route-map--cluster">
      <iframe class="route-map__frame" title="${escapeHtml(title)}" loading="lazy" src="${mapSrc}"></iframe>
      <div class="route-map__pins" aria-hidden="true">
        ${pins}
      </div>
    </div>
  `;
}

function renderOptimizerRouteMap(route, title = "VRP route map") {
  const stops = route?.stops ?? [];
  const geometryPoints = state.routeGeometryByRouteId?.[route?.id]?.coordinates ?? null;
  const points = (geometryPoints && geometryPoints.length > 1
    ? geometryPoints
    : stops.map((stop) => stop.address?.coordinates))
    .filter((coordinates) => Number.isFinite(coordinates?.lat) && Number.isFinite(coordinates?.lon));

  if (points.length === 0) {
    return `<div class="route-map route-map--empty"><div><strong>Route map pending</strong><p>Run the planning wave with geocoded stops to display the route path.</p></div></div>`;
  }

  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latRange = Math.max(0.0001, maxLat - minLat);
  const lonRange = Math.max(0.0001, maxLon - minLon);
  const padding = 0.02;
  const bbox = [minLon - padding, minLat - padding, maxLon + padding, maxLat + padding].join(",");
  const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik`;

  const coordinates = points.map((point, index) => {
    const x = 8 + ((point.lon - minLon) / lonRange) * 84;
    const y = 10 + (1 - (point.lat - minLat) / latRange) * 76;
    return {
      x: Math.min(92, Math.max(8, x + ((index % 3) - 1) * 0.5)),
      y: Math.min(88, Math.max(10, y + ((index % 2) - 0.5) * 0.6))
    };
  });

  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const markers = coordinates
    .map(
      (point, index) => `
        <span class="route-map__route-pin ${index === 0 ? "route-map__route-pin--start" : index === coordinates.length - 1 ? "route-map__route-pin--end" : ""}" style="left:${point.x}%; top:${point.y}%;" aria-hidden="true"></span>
      `
    )
    .join("");

  return `
    <div class="route-map route-map--embed route-map--routed">
      <iframe class="route-map__frame" title="${escapeHtml(title)}" loading="lazy" src="${mapSrc}"></iframe>
      <div class="route-map__overlay" aria-hidden="true">
        <svg class="route-map__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline class="route-map__polyline-shadow" points="${polyline}"></polyline>
          <polyline class="route-map__polyline" points="${polyline}"></polyline>
        </svg>
        ${markers}
      </div>
      ${state.routeGeometryByRouteId?.[route?.id]?.source === "graphhopper" ? `<span class="route-map__provider-badge">GraphHopper</span>` : ""}
    </div>
  `;
}

function renderOptimizerRouteSelector(routes, selectedRouteId, targetStage = "map") {
  if (routes.length === 0) {
    return `
      <div class="optimizer-route-selector optimizer-route-selector--empty">
        <div class="placeholder-card">
          <div>
            <h3>No route draft yet</h3>
            <p>Run the planning wave to create route cards you can inspect here.</p>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="optimizer-route-selector">
      ${routes
        .map((route) => {
          const driver = state.drivers.find((candidate) => candidate.id === route.driverId);
          const shift = state.shifts.find((candidate) => candidate.id === route.shiftId || candidate.driverId === route.driverId);
          const vehicleLabel = labelForVehicleTypeId(shift?.vehicleTypeId) || labelForVehicle(driver?.vehicleType ?? "van_3m3");

          return `
            <button class="optimizer-route-pill ${route.id === selectedRouteId ? "optimizer-route-pill--active" : ""}" type="button" data-action="select-optimizer-route" data-route-id="${route.id}" data-target-stage="${targetStage}">
              <span class="optimizer-route-pill__top">
                <strong>${escapeHtml(formatOptimizerRouteLabel(route.id))}</strong>
                <span class="status-chip" data-status="${normalizeBackendStatus(route.status)}">${escapeHtml(capitalize(route.status))}</span>
              </span>
              <span class="optimizer-route-pill__meta">
                <span>${escapeHtml(driver?.name ?? "Pending driver")}</span>
                <span>${escapeHtml(vehicleLabel)}</span>
              </span>
              <span class="optimizer-route-pill__meta">
                <span>${route.stops?.length ?? 0} stops</span>
                <span>${escapeHtml(formatDurationMinutes(route.totalDurationSeconds))}</span>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderOptimizerTimeModal() {
  const title = document.querySelector("#optimizer-time-title");
  const input = document.querySelector("#optimizer-time-value");
  const field = state.optimizerTimeField;

  if (!title || !input || !field) {
    return;
  }

  const label = field === "startTime" ? "Choose Start Time" : "Choose End Time";
  title.textContent = label;
  input.value = state.optimizerSetup[field] || "09:00";
}

function renderOptimizerStopManifestTable(route) {
  const stops = route?.stops ?? [];

  return `
    <div class="optimizer-table-wrap">
      <table class="optimizer-table optimizer-table--dense optimizer-table--manifest">
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            <th>Order</th>
            <th>Location</th>
            <th>ETA</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${stops.length > 0
            ? stops
                .map((stop) => {
                  const stopOrders = getStopOrderIds(stop)
                    .map((orderId) => state.orders.find((candidate) => candidate.id === orderId))
                    .filter(Boolean);
                  const order = stopOrders[0] ?? null;
                  const orderLabel = stopOrders.length > 1 ? `${stopOrders.length} orders` : order?.reference ?? "Manual stop";
                  const parcelLabel =
                    stopOrders.length > 1
                      ? `${stopOrders.reduce((total, candidate) => total + (candidate.parcelCount ?? 1), 0)} parcels`
                      : order?.parcelSize ?? "M";
                  const stopStatus = stop.status === "completed" ? "delivered" : stop.status === "active" ? "in_progress" : "planned";
                  return `
                    <tr>
                      <td><strong>${stop.sequence}</strong></td>
                      <td><span class="optimizer-stop-pill optimizer-stop-pill--${stop.kind}">${escapeHtml(capitalize(stop.kind))}</span></td>
                      <td>
                        <div class="optimizer-cell-stack">
                          <strong>${escapeHtml(orderLabel)}</strong>
                          <span>${escapeHtml(parcelLabel)}</span>
                        </div>
                      </td>
                      <td>
                        <div class="optimizer-cell-stack">
                          <strong>${escapeHtml(stop.address?.label ?? toAddressLabel(stop.address))}</strong>
                          <span>${escapeHtml(stop.address?.city ?? "")}</span>
                        </div>
                      </td>
                      <td>${escapeHtml(createTimeLabel(stop.plannedArrivalAt))}</td>
                      <td><span class="status-chip" data-status="${stopStatus}">${escapeHtml(capitalize(stop.status ?? "pending"))}</span></td>
                    </tr>
                  `;
                })
                .join("")
            : `<tr><td colspan="6">Select a route to display its stop manifest.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderOptimizerRoutesTable(routes, selectedRouteId) {
  return `
    <div class="optimizer-table-wrap">
      <table class="optimizer-table optimizer-table--dense optimizer-table--routes">
        <thead>
          <tr>
            <th>Route</th>
            <th>Driver</th>
            <th>Vehicle</th>
            <th>Stops</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${routes.length > 0
            ? routes
                .map((route) => {
                  const driver = state.drivers.find((candidate) => candidate.id === route.driverId);
                  const shift = state.shifts.find((candidate) => candidate.id === route.shiftId || candidate.driverId === route.driverId);
                  return `
                    <tr class="${route.id === selectedRouteId ? "optimizer-table__row--active" : ""}">
                      <td>
                        <button class="optimizer-rowlink" type="button" data-action="select-optimizer-route" data-route-id="${route.id}">
                          ${escapeHtml(route.id)}
                        </button>
                      </td>
                      <td>${escapeHtml(driver?.name ?? route.driverId ?? "Unassigned")}</td>
                      <td>${escapeHtml(labelForVehicleTypeId(shift?.vehicleTypeId) || labelForVehicle(driver?.vehicleType ?? "van_3m3"))}</td>
                      <td>${route.stops?.length ?? 0}</td>
                      <td>${escapeHtml(formatDurationMinutes(route.totalDurationSeconds))}</td>
                      <td><span class="status-chip" data-status="${normalizeBackendStatus(route.status)}">${escapeHtml(capitalize(route.status))}</span></td>
                      <td>
                        ${route.status === "ready"
                          ? `<button class="route-action route-action--primary" type="button" data-action="dispatch-route" data-route-id="${route.id}">Dispatch</button>`
                          : `<button class="route-action" type="button" data-action="select-optimizer-route" data-route-id="${route.id}">Inspect</button>`}
                      </td>
                    </tr>
                  `;
                })
                .join("")
            : `<tr><td colspan="7">No planned routes for ${escapeHtml(formatDateLabel(state.selectedDate))}. Run a planning wave to generate route drafts.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function exportOptimizerRoute(route, routeOrders) {
  if (!route || routeOrders.length === 0) {
    showToast("No route deliveries to export yet.", "error");
    return;
  }

  const rows = [
    ["route", "reference", "pickup", "dropoff", "contact", "phone", "parcel_size", "status"]
  ];

  for (const order of routeOrders) {
    rows.push([
      formatOptimizerRouteLabel(route.id),
      order.reference ?? "",
      order.pickupLabel ?? "",
      order.dropoffLabel ?? "",
      order.dropoffAddress?.contactName ?? order.pickupAddress?.contactName ?? "",
      order.dropoffAddress?.phone ?? order.pickupAddress?.phone ?? "",
      order.parcelSize ?? "M",
      labelForStatus(order.status)
    ]);
  }

  const csv = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `naaval-${route.id}-deliveries-${toPlanDate()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`${formatOptimizerRouteLabel(route.id)} exported as CSV.`);
}

function renderOptimizerView() {
  const planningJobs = getOptimizerPlanningJobs();
  const selectedPlanningJob = getSelectedPlanningJob(planningJobs);
  const selectedPlanningStats = selectedPlanningJob ? getPlanningJobStats(selectedPlanningJob) : null;
  const compareJobs = state.selectedComparePlanIds
    .map((planId) => planningJobs.find((job) => job.id === planId))
    .filter(Boolean)
    .slice(0, 2);
  const graphhopperCreditsAvailable = Boolean(state.graphhopperUsage?.limit || state.graphhopperUsage?.remaining);
  const graphhopperCreditsLabel =
    graphhopperCreditsAvailable
      ? `${state.graphhopperUsage?.remaining ?? "--"}/${state.graphhopperUsage?.limit ?? "--"}`
      : "--/--";
  const graphhopperCreditsMeta = graphhopperCreditsAvailable
    ? `${state.graphhopperUsage?.remaining ?? "--"} credits left`
    : "Credits syncing...";
  const visibleOrders = getVisibleOrders();
  const eligibleOrders = visibleOrders.filter((order) => !order.routeId && (order.sourceStatus === "ready" || order.sourceStatus === "planned"));
  const liveShifts = state.shifts;
  const visibleRoutes = getVisibleRoutes();
  const selectedRouteContext = buildOptimizerRouteContext(getOptimizerSelectedRoute(visibleRoutes));
  const selectedRoute = selectedRouteContext.route;
  const selectedDriver = selectedRouteContext.driver;
  const selectedShift = selectedRouteContext.shift;
  const mapAddresses =
    selectedRouteContext.mapAddresses.length > 0
      ? selectedRouteContext.mapAddresses
      : eligibleOrders.slice(0, 8).flatMap((order) => [order.pickupAddress, order.dropoffAddress]).filter(Boolean);
  const mapProviderLabel = getOpsConfigValue("NAAVAL_GOOGLE_MAPS_EMBED_KEY") ? "Google Maps" : "OSM fallback";
  const importSummary = state.lastImportSummary
    ? `
        <div class="optimizer-import-summary">
          <span class="mini-chip">Last import</span>
          <strong>${state.lastImportSummary.created} order(s)</strong>
          <span>${escapeHtml(state.lastImportSummary.fileName)}</span>
        </div>
      `
    : `<div class="optimizer-import-summary"><span class="mini-chip">CSV</span><strong>No recent import</strong><span>Upload a batch to feed the planning queue.</span></div>`;
  const deliveredCount = visibleOrders.filter((order) => order.status === "delivered").length;
  const inProgressCount = visibleOrders.filter((order) => order.status === "in_progress").length;
  const readyCount = eligibleOrders.length;
  const blockedCount = visibleOrders.filter((order) => order.status === "emergency").length;
  const progressTotal = Math.max(1, deliveredCount + inProgressCount + readyCount + blockedCount);
  const shiftCoverage =
    liveShifts.length > 0
      ? `${createTimeLabel(liveShifts[0].startAt)} - ${createTimeLabel(liveShifts.at(-1).endAt)}`
      : "No shift coverage";
  const avgStopsPerRoute =
    visibleRoutes.length > 0
      ? (visibleRoutes.reduce((sum, route) => sum + (route.stops?.length ?? 0), 0) / visibleRoutes.length).toFixed(1)
      : "0.0";
  const routeUtilization = liveShifts.length > 0 ? Math.min(100, Math.round((eligibleOrders.length / Math.max(1, liveShifts.length * 4)) * 100)) : 0;
  const stageMapAddresses =
    selectedRouteContext.mapAddresses.length > 0
      ? selectedRouteContext.mapAddresses
      : eligibleOrders.flatMap((order) => [order.pickupAddress, order.dropoffAddress]).filter(Boolean);
  const selectedRouteLabel = selectedRoute ? formatOptimizerRouteLabel(selectedRoute.id) : "No route selected";
  const selectedVehicleLabel = selectedRoute
    ? labelForVehicleTypeId(selectedShift?.vehicleTypeId) || labelForVehicle(selectedDriver?.vehicleType ?? "van_3m3")
    : "Pending vehicle";
  const customerFallback =
    eligibleOrders[0]?.merchantId ??
    visibleOrders[0]?.merchantId ??
    getVisibleCustomers()[0]?.merchantId ??
    getVisibleCustomers()[0]?.name ??
    "UNAMIDO";
  const customerLabel = state.optimizerSetup.customer || customerFallback;
  const handlingMinutes = state.optimizerSetup.handlingMinutes ?? 10;
  const pickupLandingMinutes = state.optimizerSetup.pickupLandingMinutes ?? 15;
  const pickupAddressFallback = state.hubs[0]?.address ?? state.hubs[0]?.label ?? "12 Rue du Germoir 5, 1050 Ixelles, Belgium";
  const pickupAddressLabel = state.optimizerSetup.pickupAddress || pickupAddressFallback;
  const startTimeLabel = formatOptimizerTimeValue(state.optimizerSetup.startTime ?? "09:00");
  const endTimeLabel = formatOptimizerTimeValue(state.optimizerSetup.endTime ?? "23:00");
  const selectedTrucks = state.optimizerSetup.trucks ?? 10;
  const customerOptions = [...new Set(
    [
      ...state.customers.flatMap((customer) => [customer.name, customer.merchantId]),
      ...state.accountCustomers.flatMap((customer) => [customer.name, customer.merchantId]),
      ...state.orders.map((order) => order.merchantId),
      customerLabel
    ]
      .filter(Boolean)
      .map((value) => String(value).trim())
  )].sort((left, right) => left.localeCompare(right));
  const optimizerFormulaOptions = [
    { id: "completion_time", label: "minimization of completion time" },
    { id: "distance", label: "minimization of total distance" },
    { id: "balanced_load", label: "balanced route load" }
  ];
  const sizeOptions = ["S", "M", "L", "XL", "XXL"];
  const handlingOptions = Array.from({ length: 12 }, (_, index) => (index + 1) * 5);
  const truckOptions = Array.from({ length: 70 }, (_, index) => index + 1);
  const activeSizeIndex = Math.max(0, sizeOptions.indexOf(state.optimizerSetup.parcelSize ?? "S"));
  const sizeProgress = sizeOptions.length > 1 ? (activeSizeIndex / (sizeOptions.length - 1)) * 100 : 0;
  const displayedOrders = eligibleOrders.length > 0 ? eligibleOrders : visibleOrders;
  const totalDistanceKm = Math.round((visibleRoutes.reduce((sum, route) => sum + (route.totalDistanceMeters ?? 0), 0) || displayedOrders.length * 14500) / 1000);
  const routeCount = Math.max(visibleRoutes.length, Math.min(3, Math.max(1, liveShifts.length)));
  const globalDurationMinutes =
    visibleRoutes.length > 0
      ? Math.round(visibleRoutes.reduce((sum, route) => sum + (route.totalDurationSeconds ?? 0), 0) / 60)
      : Math.max(240, routeCount * 120);
  const timePerRoadMinutes = Math.max(120, Math.round(globalDurationMinutes / Math.max(1, routeCount)));
  const primaryVolume = displayedOrders[0]?.parcelSize ?? state.optimizerSetup.parcelSize ?? "Medium";
  const selectedRouteIndex = selectedRoute ? Math.max(0, visibleRoutes.findIndex((route) => route.id === selectedRoute.id)) : -1;
  const selectedRouteTitle = selectedRouteIndex >= 0 ? `Route ${selectedRouteIndex + 1}` : "Route 1";
  const selectedRouteSummaryStart = selectedRoute?.stops?.[0]?.plannedArrivalAt
    ? createTimeLabel(selectedRoute.stops[0].plannedArrivalAt)
    : selectedShift?.startAt
      ? createTimeLabel(selectedShift.startAt)
      : startTimeLabel;
  const selectedRouteSummaryEnd = selectedRoute?.stops?.at(-1)?.plannedDepartureAt
    ? createTimeLabel(selectedRoute.stops.at(-1).plannedDepartureAt)
    : selectedShift?.endAt
      ? createTimeLabel(selectedShift.endAt)
      : endTimeLabel;
  const selectedRouteDistanceKm = Math.max(
    1,
    Math.round((selectedRoute?.totalDistanceMeters ?? (selectedRoute?.stops?.length ?? 1) * 4300) / 1000)
  );
  const selectedRouteDurationMinutes = Math.max(
    30,
    Math.round((selectedRoute?.totalDurationSeconds ?? timePerRoadMinutes * 60) / 60)
  );
  const selectedRouteRoadTime = formatDurationMinutes(selectedRouteDurationMinutes * 60);
  const selectedRouteManutention = handlingMinutes * Math.max(1, selectedRouteContext.routeOrders.length || selectedRoute?.stops?.length || 1);
  const selectedRouteOrders = selectedRouteContext.routeOrders.length > 0 ? selectedRouteContext.routeOrders : displayedOrders.slice(0, 6);

  let stageBody = "";

  if (state.activeOptimizerStage === "history") {
    stageBody = `
      <article class="optimizer-sheet optimizer-sheet--history">
        <div class="optimizer-history-top">
          <div class="optimizer-history-inline">
            <div class="optimizer-history-inline__item optimizer-history-inline__item--credits">
              <span>Credits</span>
              <strong>${escapeHtml(graphhopperCreditsLabel)}</strong>
              <small>${escapeHtml(graphhopperCreditsMeta)}</small>
            </div>
            <div class="optimizer-history-inline__item">
              <span>Optimizations</span>
              <strong>${planningJobs.length}</strong>
            </div>
            <div class="optimizer-history-inline__item optimizer-history-inline__item--meta">
              <span>${escapeHtml(
                state.graphhopperUsageLoading
                  ? "Refreshing credits..."
                  : state.graphhopperUsage?.updatedAt
                    ? `Updated ${formatDateTimeLabel(state.graphhopperUsage.updatedAt)}`
                    : "Waiting for first credit sync"
              )}</span>
            </div>
          </div>
          <div class="optimizer-history-actions">
            <button class="solid-button" type="button" data-action="open-optimizer-builder">New Run</button>
          </div>
        </div>

        <div class="optimizer-history-layout">
          <section class="detail-card optimizer-history-list">
            <div class="optimizer-history-list__header">
              <div>
                <p class="eyebrow">Routing History</p>
                <h3>Past optimizations</h3>
              </div>
            </div>
            <div class="optimizer-history-list__items">
              ${planningJobs.length > 0
                ? planningJobs
                    .map((job, index) => {
                      const stats = getPlanningJobStats(job);
                      const isCompared = state.selectedComparePlanIds.includes(job.id);
                      return `
                        <article class="optimizer-history-row ${isCompared ? "optimizer-history-row--active" : ""}">
                          <button class="optimizer-history-row__main" type="button" data-action="open-plan-routes" data-plan-id="${job.id}">
                            <span class="optimizer-history-row__name">${escapeHtml(getPlanningJobDisplayName(job, index))}</span>
                            <span class="optimizer-history-row__stats">
                              <span class="optimizer-history-stat" title="Trucks">🚚 ${stats.driverCount}</span>
                              <span class="optimizer-history-stat" title="Routes">🛣️ ${stats.routeCount}</span>
                              <span class="optimizer-history-stat" title="Stops">📍 ${stats.stopCount}</span>
                            </span>
                          </button>
                          <div class="optimizer-history-row__actions">
                            <button class="ghost-button optimizer-history-row__compare" type="button" data-action="toggle-compare-plan" data-plan-id="${job.id}">
                              ${isCompared ? "Compared" : "Compare"}
                            </button>
                          </div>
                        </article>
                      `;
                    })
                    .join("")
                : `<div class="placeholder-card"><div><h3>No optimization yet</h3><p>Run your first VRP wave, then come back here to compare route drafts.</p></div></div>`}
            </div>
          </section>
        </div>

        <section class="detail-card optimizer-compare-card">
          <div class="optimizer-history-list__header">
            <div>
              <p class="eyebrow">Routing Compare</p>
              <h3>Compare 2 optimizations</h3>
            </div>
          </div>
          ${compareJobs.length === 2
            ? `
              <div class="optimizer-compare-grid">
                ${compareJobs
                  .map((job, index) => {
                    const stats = getPlanningJobStats(job);
                    return `
                      <article class="optimizer-compare-column">
                        <span class="mini-chip">Scenario ${index + 1}</span>
                        <h4>${escapeHtml(getPlanningJobDisplayName(job, planningJobs.findIndex((candidate) => candidate.id === job.id)))}</h4>
                        <div class="optimizer-history-kv">
                          <div><span>Solver</span><strong>${escapeHtml(String(job.solver || "mock").toUpperCase())}</strong></div>
                          <div><span>Objective</span><strong>${escapeHtml(capitalize(job.objectivePreset || "balanced"))}</strong></div>
                          <div><span>Routes</span><strong>${stats.routeCount}</strong></div>
                          <div><span>Orders</span><strong>${stats.orderCount}</strong></div>
                          <div><span>Total KM</span><strong>${stats.totalDistanceKm} KM</strong></div>
                          <div><span>Total Time</span><strong>${escapeHtml(stats.totalDurationLabel)}</strong></div>
                          <div><span>Revenue</span><strong>${escapeHtml(stats.revenueLabel)}</strong></div>
                        </div>
                      </article>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `
              <div class="placeholder-card">
                <div>
                  <h3>Select two runs</h3>
                  <p>Use the compare button on each run line to pin two optimizations side by side.</p>
                </div>
              </div>
            `}
        </section>
      </article>
    `;
  } else if (state.activeOptimizerStage === "setup") {
    stageBody = `
      <article class="optimizer-sheet optimizer-sheet--setup-mock">
        <div class="optimizer-sheet__header optimizer-sheet__header--setup-mock">
          <div>
            <p class="eyebrow">VRP Setup</p>
            <h3>Wave Configuration</h3>
          </div>
          <button class="solid-button optimizer-sheet__download" type="button" data-action="download-csv-template">Download CSV Template</button>
        </div>

        <div class="optimizer-mock-grid">
          <div class="optimizer-mock-stack">
            <div class="optimizer-mock-row">
              <span>VRP Name</span>
              <strong>
                <input class="optimizer-mock-input" type="text" value="${escapeHtml(state.optimizerSetup.name)}" data-optimizer-setup="name" />
              </strong>
            </div>
            <div class="optimizer-mock-row">
              <span>Date</span>
              <strong>
                <input class="optimizer-mock-input optimizer-mock-input--date" type="date" value="${escapeHtml(state.selectedDate)}" data-optimizer-setup="date" />
              </strong>
            </div>
            <div class="optimizer-mock-row">
              <span>Start</span>
              <strong>
                <button class="optimizer-mock-trigger" type="button" data-action="open-optimizer-time" data-time-field="startTime">${escapeHtml(startTimeLabel)}</button>
              </strong>
            </div>
            <div class="optimizer-mock-row">
              <span>Manutention</span>
              <strong>
                <select class="optimizer-mock-select" data-optimizer-setup="handlingMinutes">
                  ${handlingOptions
                    .map(
                      (minutes) => `
                        <option value="${minutes}" ${minutes === handlingMinutes ? "selected" : ""}>${minutes} MIN</option>
                      `
                    )
                    .join("")}
                </select>
              </strong>
            </div>
          </div>

          <div class="optimizer-mock-stack">
            <div class="optimizer-mock-row">
              <span>Customer</span>
              <strong>
                <input class="optimizer-mock-input" type="text" list="optimizer-customer-options" value="${escapeHtml(String(customerLabel).toUpperCase())}" data-optimizer-setup="customer" />
              </strong>
            </div>
            <div class="optimizer-mock-row">
              <span>Trucks</span>
              <strong>
                <select class="optimizer-mock-select" data-optimizer-setup="trucks">
                  ${truckOptions
                    .map(
                      (count) => `
                        <option value="${count}" ${count === selectedTrucks ? "selected" : ""}>${count}</option>
                      `
                    )
                    .join("")}
                </select>
              </strong>
            </div>
            <div class="optimizer-mock-row">
              <span>End</span>
              <strong>
                <button class="optimizer-mock-trigger" type="button" data-action="open-optimizer-time" data-time-field="endTime">${escapeHtml(endTimeLabel)}</button>
              </strong>
            </div>
            <div class="optimizer-mock-row">
              <span>Pickup Landing</span>
              <strong>
                <select class="optimizer-mock-select" data-optimizer-setup="pickupLandingMinutes">
                  ${handlingOptions
                    .map(
                      (minutes) => `
                        <option value="${minutes}" ${minutes === pickupLandingMinutes ? "selected" : ""}>${minutes} MIN</option>
                      `
                    )
                    .join("")}
                </select>
              </strong>
            </div>
          </div>
        </div>

        <datalist id="optimizer-customer-options">
          ${customerOptions.map((customer) => `<option value="${escapeHtml(String(customer).toUpperCase())}"></option>`).join("")}
        </datalist>

        <section class="optimizer-mock-size">
          <div class="optimizer-mock-row optimizer-mock-row--center">
            <span>Parcel Size</span>
            <strong>${escapeHtml(state.optimizerSetup.parcelSize)}</strong>
          </div>
          <div class="optimizer-size-scale">
            <div class="optimizer-size-scale__labels">
              ${sizeOptions
                .map(
                  (size) => `
                    <button class="optimizer-size-scale__label ${size === state.optimizerSetup.parcelSize ? "optimizer-size-scale__label--active" : ""}" type="button" data-action="set-optimizer-setup-size" data-size="${size}">
                      ${size}
                    </button>
                  `
                )
                .join("")}
            </div>
            <div class="optimizer-size-scale__track">
              <span class="optimizer-size-scale__fill" style="width:${sizeProgress}%"></span>
              <span class="optimizer-size-scale__thumb" style="left:${sizeProgress}%"></span>
            </div>
          </div>
        </section>

        <div class="optimizer-mock-row optimizer-mock-row--wide">
          <span>Pickup Address</span>
          <strong>
            <input class="optimizer-mock-input" type="text" value="${escapeHtml(String(pickupAddressLabel).toUpperCase())}" data-optimizer-setup="pickupAddress" />
          </strong>
        </div>

        <label class="optimizer-mock-row optimizer-mock-row--wide optimizer-mock-row--select">
          <span>Choose Formula</span>
          <select class="optimizer-setup-select" data-optimizer-formula>
            ${optimizerFormulaOptions
              .map(
                (option) => `
                  <option value="${option.id}" ${option.id === state.optimizerSetup.formula ? "selected" : ""}>
                    ${escapeHtml(option.label)}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>

        <button class="optimizer-upload-surface" type="button" data-action="import-csv">
          <span>Upload CSV Files</span>
          <small>reference, customer, address, postcode, city, phone, email, parcel size</small>
        </button>

        <div class="optimizer-setup-footer">
          <div class="optimizer-import-summary optimizer-import-summary--setup">
            ${importSummary}
          </div>
          <div class="detail-actions optimizer-actionbar optimizer-actionbar--end">
            <button class="ghost-button" type="button" data-action="seed-demo">Seed Demo</button>
            <button class="solid-button optimizer-setup-submit" type="button" data-action="run-planning">Optimized</button>
          </div>
        </div>
      </article>
    `;
  } else if (state.activeOptimizerStage === "orders") {
    stageBody = `
      <article class="optimizer-sheet optimizer-sheet--orders-mock">
        <div class="optimizer-sheet__header optimizer-sheet__header--orders-mock">
          <div></div>
          <button class="solid-button optimizer-sheet__download" type="button" data-action="download-csv-template">Download CSV Template</button>
        </div>

        ${renderOptimizerSpreadsheetTable(
          eligibleOrders.length > 0 ? eligibleOrders : visibleOrders,
          "No visible orders found for this day. Create one or import a CSV batch first."
        )}

        <div class="optimizer-orders-footer">
          <div class="optimizer-import-summary optimizer-import-summary--setup">
            ${importSummary}
          </div>
          <div class="detail-actions optimizer-actionbar optimizer-actionbar--end">
            <button class="solid-button optimizer-validate-button" type="button" data-action="validate-optimizer-data">
              <span>Validate Data</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </article>
    `;
  } else if (state.activeOptimizerStage === "map") {
    stageBody = `
      <article class="optimizer-sheet optimizer-sheet--map-mock">
        <div class="optimizer-sheet__header optimizer-sheet__header--orders-mock">
          <div></div>
          <button class="solid-button optimizer-sheet__download" type="button" data-action="download-csv-template">Download CSV Template</button>
        </div>

        <div class="optimizer-map-layout">
          <div class="optimizer-map-canvas">
            ${renderOptimizerClusterMap(displayedOrders, "VRP planning map")}
          </div>

          <aside class="optimizer-map-summary">
            <div class="optimizer-map-summary__row"><span>Date:</span><strong>${escapeHtml(formatOptimizerSetupDate(state.selectedDate))}</strong></div>
            <div class="optimizer-map-summary__row"><span>Start:</span><strong>${escapeHtml(startTimeLabel)}</strong></div>
            <div class="optimizer-map-summary__row"><span>End:</span><strong>${escapeHtml(endTimeLabel)}</strong></div>
            <div class="optimizer-map-summary__row"><span>Volume:</span><strong>${escapeHtml(String(primaryVolume).toUpperCase())}</strong></div>
            <div class="optimizer-map-summary__row"><span>Vehicle:</span><strong>${selectedTrucks}</strong></div>
            <div class="optimizer-map-summary__row"><span>Global Time:</span><strong>${escapeHtml(formatDurationMinutes(globalDurationMinutes * 60))}</strong></div>
            <div class="optimizer-map-summary__row"><span>Manutention:</span><strong>${handlingMinutes * Math.max(1, displayedOrders.length)} MIN</strong></div>
            <div class="optimizer-map-summary__row"><span>KM:</span><strong>${totalDistanceKm} KM</strong></div>
            <div class="optimizer-map-summary__row"><span>Number of Road:</span><strong>${routeCount}</strong></div>
            <div class="optimizer-map-summary__row"><span>Time / Road:</span><strong>${escapeHtml(formatDurationMinutes(timePerRoadMinutes * 60))}</strong></div>
          </aside>
        </div>

        ${renderOptimizerSpreadsheetTable(
          displayedOrders,
          "No visible orders found for this day. Create one or import a CSV batch first."
        )}

        <div class="optimizer-orders-footer">
          <div class="optimizer-import-summary optimizer-import-summary--setup">
            ${importSummary}
          </div>
          <div class="detail-actions optimizer-actionbar optimizer-actionbar--end">
            <button class="solid-button optimizer-validate-button" type="button" data-action="run-planning">
              <span>Run Routing</span>
            </button>
          </div>
        </div>
      </article>
    `;
  } else {
    const routeButtons = visibleRoutes
      .map((route, index) => {
        const isActive = route.id === selectedRoute?.id;
        return `
          <button class="optimizer-road-switch ${isActive ? "optimizer-road-switch--active" : ""}" type="button" data-action="select-optimizer-route" data-route-id="${route.id}" data-target-stage="routes">
            ROAD ${index + 1}
          </button>
        `;
      })
      .join("");

    stageBody = `
      <article class="optimizer-sheet optimizer-sheet--routes-mock">
        <div class="optimizer-routes-layout">
          <div class="optimizer-routes-mapcard">
            ${selectedRoute ? renderOptimizerRouteMap(selectedRoute, `${selectedRouteTitle} map`) : buildMapEmbed(stageMapAddresses, "VRP route map")}
          </div>

          <aside class="optimizer-map-summary optimizer-map-summary--route">
            <div class="optimizer-map-summary__title">${escapeHtml(selectedRouteTitle.toUpperCase())}</div>
            <div class="optimizer-map-summary__row"><span>Date:</span><strong>${escapeHtml(formatOptimizerSetupDate(state.selectedDate))}</strong></div>
            <div class="optimizer-map-summary__row"><span>Start:</span><strong>${escapeHtml(selectedRouteSummaryStart)}</strong></div>
            <div class="optimizer-map-summary__row"><span>End:</span><strong>${escapeHtml(selectedRouteSummaryEnd)}</strong></div>
            <div class="optimizer-map-summary__row"><span>Volume:</span><strong>${escapeHtml(String(primaryVolume).toUpperCase())}</strong></div>
            <div class="optimizer-map-summary__row"><span>Global Time:</span><strong>${escapeHtml(formatDurationMinutes(selectedRouteDurationMinutes * 60))}</strong></div>
            <div class="optimizer-map-summary__row"><span>Manutention:</span><strong>${selectedRouteManutention} MIN</strong></div>
            <div class="optimizer-map-summary__row"><span>KM:</span><strong>${selectedRouteDistanceKm} KM</strong></div>
            <div class="optimizer-map-summary__row"><span>Time / Road:</span><strong>${escapeHtml(selectedRouteRoadTime)}</strong></div>
          </aside>
        </div>

        <div class="optimizer-road-switcher ${visibleRoutes.length === 0 ? "optimizer-road-switcher--empty" : ""}">
          ${visibleRoutes.length > 0
            ? routeButtons
            : `<button class="optimizer-road-switch optimizer-road-switch--ghost" type="button" data-action="run-planning">ROAD 1</button>`}
        </div>

        ${renderOptimizerSpreadsheetTable(
          selectedRouteOrders,
          "No route deliveries yet. Run the routing wave to generate a route manifest."
        )}

        <div class="optimizer-routes-footer">
          <div class="detail-actions optimizer-actionbar optimizer-actionbar--end">
            <button class="solid-button optimizer-validate-button" type="button" data-action="export-optimizer-route">
              <span>Export Deliveries</span>
            </button>
            ${selectedRoute
              ? `<button class="solid-button optimizer-validate-button" type="button" data-action="dispatch-route" data-route-id="${selectedRoute.id}"><span>Create Deliveries</span></button>`
              : `<button class="solid-button optimizer-validate-button" type="button" data-action="run-planning"><span>Create Deliveries</span></button>`}
          </div>
        </div>
      </article>
    `;
  }

  return `
    <div class="optimizer-shell">
      ${state.activeOptimizerStage === "history" ? "" : renderOptimizerStageTabs()}
      ${stageBody}
    </div>
  `;
}

function renderInvoicesView() {
  const invoices = getVisibleInvoices();

  return `
    <section class="stack">
      <div class="invoice-list">
        ${invoices.length > 0
          ? invoices
              .map(
                (invoice) => `
                  <article class="invoice-row">
                    <span class="invoice-badge">€</span>
                    <div class="invoice-row__main">
                      <div class="invoice-row__title">
                        <strong>${escapeHtml(invoice.number)}</strong>
                        <span class="status-chip" data-status="${invoice.status === "issued" ? "delivered" : invoice.status === "review" ? "emergency" : "planned"}">${escapeHtml(capitalize(invoice.status))}</span>
                      </div>
                      <div class="invoice-row__meta">
                        <span class="emoji-chip">🏢 ${escapeHtml(invoice.customerName)}</span>
                        <span class="emoji-chip">🗓️ ${escapeHtml(formatDateLabel(invoice.dateKey))}</span>
                        <span class="emoji-chip">📦 ${invoice.orderCount} orders</span>
                        <span class="emoji-chip">🧾 ${escapeHtml(invoice.merchantId)}</span>
                      </div>
                      <span class="panel__subtitle">${escapeHtml(invoice.billingAddress)}</span>
                    </div>
                    <span class="price-stack">
                      <strong class="price-stack__value">${formatCurrency(invoice.amount)}</strong>
                      <span class="price-stack__meta">HT</span>
                    </span>
                  </article>
                `
              )
              .join("")
          : `<div class="placeholder-card"><div><h3>No invoices for ${escapeHtml(formatDateLabel(state.selectedDate))}</h3><p>The invoice workspace is generated from the orders visible on the selected day.</p></div></div>`}
      </div>
    </section>
  `;
}

function renderVehicleChoiceList(rateMap, selectedVehicle, actionName) {
  return Object.entries(rateMap)
    .map(
      ([vehicleType, price]) => `
        <button class="vehicle-choice ${vehicleType === selectedVehicle ? "vehicle-choice--active" : ""}" type="button" data-action="${actionName}" data-vehicle-type="${vehicleType}">
          <span class="vehicle-choice__copy">
            <strong>${escapeHtml(labelForVehicle(vehicleType))}</strong>
            <span>${formatCurrency(price)} HT</span>
          </span>
          <span class="vehicle-choice__toggle" aria-hidden="true"></span>
        </button>
      `
    )
    .join("");
}

function renderPricingView() {
  const config = getPricingConfig();
  const draft = getPricingDraft();
  const basic = calculateBasicPrice(config, draft);
  const pallet = calculatePalletPrice(config, draft);
  const hourly = calculateHourlyPrice(config, draft);
  const drops = calculateDropPrice(config, draft);
  const selected = state.selectedPricingAlgo;
  const pricingTabs = ADMIN_PRICING_ALGOS.map(
    (algo) => `
      <button class="pricing-pill ${selected === algo.id ? "pricing-pill--active" : ""}" type="button" data-action="set-pricing-algo-view" data-algo-id="${algo.id}">
        ${escapeHtml(algo.title)}
      </button>
    `
  ).join("");

  let title = "";
  let tag = "";
  let fieldsMarkup = "";
  let noteMarkup = "";
  let amount = 0;

  if (selected === "basic") {
    title = "Basic Algo";
    tag = "Basic Algo";
    amount = basic.total;
    fieldsMarkup = `
      <div class="size-selector">
        ${["S", "M", "L", "XL", "XXL"]
          .map(
            (size) => `
              <button class="size-selector__item ${size === draft.basic.parcelSize ? "size-selector__item--active" : ""}" type="button" data-action="set-pricing-basic-size" data-size="${size}">
                <span class="size-selector__dot"></span>
                <span>${size}</span>
              </button>
            `
          )
          .join("")}
      </div>
      <label class="field pricing-card__field">
        <span>Distance</span>
        <div class="inline-input">
          <input type="number" min="0" step="0.5" value="${basic.distanceKm}" data-pricing-draft="basic.distanceKm" />
          <span>KM</span>
        </div>
      </label>
    `;
  } else if (selected === "pallet") {
    title = "Palette";
    tag = "Palette";
    amount = pallet.total;
    fieldsMarkup = `
      <label class="field pricing-card__field">
        <span>Palettes</span>
        <input type="number" min="1" step="1" value="${pallet.palletCount}" data-pricing-draft="pallet.palletCount" />
      </label>
      <div class="pricing-readout">
        <span>Camion Necessaire</span>
        <strong>${escapeHtml(labelForVehicle(pallet.vehicleType))}</strong>
      </div>
      <label class="field pricing-card__field">
        <span>Nombre d'aller / retour</span>
        <input type="number" min="1" step="1" value="${pallet.roundTrips}" data-pricing-draft="pallet.roundTrips" />
      </label>
    `;
    noteMarkup = `
      <div class="pricing-note-list">
        <p>Le tarif palette suit la grille admin et s'applique par trajet facture.</p>
        <p>Le vehicule recommande depend des seuils palettes configures en admin.</p>
      </div>
    `;
  } else if (selected === "hours") {
    title = "By Hours";
    tag = "By Hours";
    amount = hourly.total;
    fieldsMarkup = `
      <label class="field pricing-card__field">
        <span>Hours</span>
        <input type="number" min="1" step="1" value="${hourly.enteredHours}" data-pricing-draft="hours.hours" />
      </label>
      <div class="vehicle-choice-list">
        ${renderVehicleChoiceList(config.hours.vehicleHourlyRates, draft.hours.vehicleType, "set-pricing-hours-vehicle")}
      </div>
    `;
    noteMarkup = `
      <div class="pricing-note-list">
        <p>Nous conseillons un minimum de ${config.hours.minimumHours}h facturees avec ${config.hours.includedKm}km inclus.</p>
      </div>
    `;
  } else {
    title = "By Drop";
    tag = "By Drop";
    amount = drops.total;
    fieldsMarkup = `
      <label class="field pricing-card__field">
        <span>Drops</span>
        <input type="number" min="1" step="1" value="${drops.requestedDrops}" data-pricing-draft="drops.drops" />
      </label>
      <div class="vehicle-choice-list">
        ${renderVehicleChoiceList(config.drops.vehicleDropRates, draft.drops.vehicleType, "set-pricing-drops-vehicle")}
      </div>
    `;
    noteMarkup = `
      <div class="pricing-note-list">
        <p>Minimum ${config.drops.minimumDrops} drops factures par tournee avec ${config.drops.includedKm}km inclus.</p>
      </div>
    `;
  }

  return `
    <div class="pricing-workbench">
      <div class="pricing-pillbar">
        ${pricingTabs}
      </div>

      <article class="pricing-card pricing-card--focus">
        <div class="pricing-card__headerline">
          <div>
            <div class="pricing-card__tag">${escapeHtml(tag)}</div>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <div class="pricing-card__actionsline">
            <div class="pricing-price pricing-price--inline">
              <span>Prix HT</span>
              <strong>${formatCurrency(amount)}</strong>
            </div>
            <button class="subtle-button" type="button" data-action="open-quote" data-quote-source="${selected}">Quote</button>
            <button class="ghost-button" type="button" data-action="open-quote-email" data-quote-source="${selected}">Send via Email</button>
          </div>
        </div>

        ${fieldsMarkup}
        ${noteMarkup}
      </article>
    </div>
  `;
}

function summarizeAdminPricingAlgo(algoId, config = getPricingConfig()) {
  if (algoId === "basic") {
    return [
      `${formatCurrency(config.basic.distanceRatePerKm)} / km`,
      `Base L ${formatCurrency(config.basic.sizeBasePrices.L)}`,
      `Base XXL ${formatCurrency(config.basic.sizeBasePrices.XXL)}`
    ];
  }

  if (algoId === "pallet") {
    return [
      `${formatCurrency(config.pallet.pricePerPallet)} / pallet`,
      `3m3 ${config.pallet.vehicleThresholds.van_3m3} pallets`,
      `20m3 ${config.pallet.vehicleThresholds.van_20m3} pallets`
    ];
  }

  if (algoId === "hours") {
    return [
      `${config.hours.minimumHours}h minimum`,
      `${config.hours.includedKm} km included`,
      `3m3 ${formatCurrency(config.hours.vehicleHourlyRates.van_3m3)} / h`
    ];
  }

  return [
    `${config.drops.minimumDrops} drops minimum`,
    `${config.drops.includedKm} km included`,
    `3m3 ${formatCurrency(config.drops.vehicleDropRates.van_3m3)} / drop`
  ];
}

function renderAdminPricingCard(algo) {
  const summary = summarizeAdminPricingAlgo(algo.id);

  return `
    <button class="admin-algo-card" type="button" data-action="open-admin-pricing-algo" data-algo-id="${algo.id}">
      <span class="pricing-card__tag">${escapeHtml(algo.tag)}</span>
      <strong>${escapeHtml(algo.title)}</strong>
      <span>${escapeHtml(algo.description)}</span>
      <div class="admin-algo-card__meta">
        ${summary.map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join("")}
      </div>
    </button>
  `;
}

function renderAdminView() {
  const editingOpsUser = state.editingOpsUserId ? state.opsUsers.find((candidate) => candidate.id === state.editingOpsUserId) : null;
  const usersMarkup =
    state.opsUsers.length > 0
      ? state.opsUsers
          .map(
            (user) => `
              <div class="admin-user-row">
                <button class="admin-user-row__main" type="button" data-action="open-ops-user-detail" data-ops-user-id="${user.id}">
                  <div>
                    <p class="route-card__title">${escapeHtml(`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email)}</p>
                    <div class="route-card__meta">
                      <span>${escapeHtml(user.email)}</span>
                      <span>${escapeHtml(user.team ?? "Operations")}</span>
                    </div>
                  </div>
                  <span class="status-chip" data-status="${user.status === "active" ? "active" : "idle"}">${escapeHtml(labelForOpsRole(user.role))}</span>
                </button>
                <button class="ghost-button admin-user-row__delete" type="button" data-action="delete-ops-user" data-ops-user-id="${user.id}">Delete User</button>
              </div>
            `
          )
          .join("")
      : `<div class="placeholder-card"><div><h3>No ops users yet</h3><p>Create the first operations account from this admin section.</p></div></div>`;

  return `
    <div class="admin-layout">
      <div class="admin-menu">
        <button class="admin-menu__item ${state.adminSection === "pricing" ? "admin-menu__item--active" : ""}" type="button" data-action="set-admin-section" data-admin-section="pricing">
          <strong>Pricing Algo</strong>
          <span>Setup pricing rules and simulation coefficients.</span>
        </button>
        <button class="admin-menu__item ${state.adminSection === "users" ? "admin-menu__item--active" : ""}" type="button" data-action="set-admin-section" data-admin-section="users">
          <strong>New User</strong>
          <span>Create operations accounts and review current ops users.</span>
        </button>
      </div>

      ${state.adminSection === "pricing"
        ? `
      <section class="admin-card">
        <div class="admin-card__header">
          <div>
            <p class="eyebrow">Setup Algo</p>
            <h3>Pricing Algorithms</h3>
            <p class="panel__subtitle">Select an algorithm by name to open its setup modal and edit the coefficients.</p>
          </div>
        </div>
        <div class="admin-algo-list">
          ${ADMIN_PRICING_ALGOS.map((algo) => renderAdminPricingCard(algo)).join("")}
        </div>
      </section>
        `
        : `
      <section class="admin-card">
        <div class="admin-card__header">
          <div>
            <p class="eyebrow">User</p>
            <h3>${editingOpsUser ? "Edit Ops Account" : "Create Ops Accounts"}</h3>
          </div>
        </div>

        <form id="ops-user-form" class="admin-form-stack">
          <input type="hidden" name="userId" value="${escapeHtml(editingOpsUser?.id ?? "")}" />
          <div class="form-grid">
            <label class="field">
              <span>First Name</span>
              <input name="firstName" placeholder="Amina" value="${escapeHtml(editingOpsUser?.firstName ?? "")}" required />
            </label>
            <label class="field">
              <span>Last Name</span>
              <input name="lastName" placeholder="Laurent" value="${escapeHtml(editingOpsUser?.lastName ?? "")}" required />
            </label>
            <label class="field">
              <span>Email</span>
              <input name="email" type="email" placeholder="ops@naaval.app" value="${escapeHtml(editingOpsUser?.email ?? "")}" required />
            </label>
            <label class="field">
              <span>Role</span>
              <select name="role">
                <option value="ops_admin" ${editingOpsUser?.role === "ops_admin" ? "selected" : ""}>Ops Admin</option>
                <option value="ops_manager" ${editingOpsUser?.role === "ops_manager" ? "selected" : ""}>Ops Manager</option>
                <option value="ops_dispatcher" ${editingOpsUser?.role === "ops_dispatcher" ? "selected" : ""}>Dispatcher</option>
                <option value="ops_agent" ${!editingOpsUser || editingOpsUser?.role === "ops_agent" ? "selected" : ""}>Ops Agent</option>
              </select>
            </label>
            <label class="field">
              <span>Team</span>
              <input name="team" value="${escapeHtml(editingOpsUser?.team ?? "Operations")}" />
            </label>
            <label class="field">
              <span>Temporary Password</span>
              <input name="temporaryPassword" placeholder="Temp-Password-001" value="${escapeHtml(editingOpsUser?.temporaryPassword ?? "")}" />
            </label>
          </div>

          <p class="panel__subtitle">${editingOpsUser ? "Update the ops account, then save the changes. The login password used on the dashboard is the temporary password shown here." : "This password is the one the new ops user will use on the login page. If you leave it empty, it defaults to <code>demo</code>."}</p>

          <div class="form-actions admin-actions">
            ${editingOpsUser ? '<button class="ghost-button" type="button" data-action="cancel-edit-ops-user">Cancel</button>' : ""}
            <button class="solid-button" type="submit">${editingOpsUser ? "Save Ops User" : "Create Ops User"}</button>
          </div>
        </form>

        <div class="route-list admin-user-list">
          ${usersMarkup}
        </div>
      </section>
        `}
    </div>
  `;
}

function renderAdminPricingModalForm() {
  const content = document.querySelector("#admin-pricing-modal-content");
  if (!content) {
    return;
  }

  if (!state.selectedAdminPricingAlgo) {
    content.innerHTML = `
      <div class="placeholder-card"><div><h3>No algorithm selected</h3><p>Pick a pricing algorithm from the admin list to configure it here.</p></div></div>
    `;
    return;
  }

  const algo = getAdminPricingAlgoMeta(state.selectedAdminPricingAlgo);
  const config = getPricingConfig();
  let fieldsMarkup = "";

  if (algo.id === "basic") {
    fieldsMarkup = `
      <div class="form-grid">
        <label class="field">
          <span>Distance Rate / Km</span>
          <input name="basicDistanceRatePerKm" type="number" min="0" step="0.01" value="${config.basic.distanceRatePerKm}" />
        </label>
        ${["S", "M", "L", "XL", "XXL"]
          .map(
            (size) => `
              <label class="field">
                <span>Base ${size}</span>
                <input name="basicSize_${size}" type="number" min="0" step="0.01" value="${config.basic.sizeBasePrices[size]}" />
              </label>
            `
          )
          .join("")}
      </div>
    `;
  } else if (algo.id === "pallet") {
    fieldsMarkup = `
      <div class="form-grid">
        <label class="field">
          <span>Price / Pallet</span>
          <input name="palletPricePerPallet" type="number" min="0" step="0.01" value="${config.pallet.pricePerPallet}" />
        </label>
        <label class="field">
          <span>3m3 Max Pallets</span>
          <input name="palletThreshold_van_3m3" type="number" min="1" step="1" value="${config.pallet.vehicleThresholds.van_3m3}" />
        </label>
        <label class="field">
          <span>5m3 Max Pallets</span>
          <input name="palletThreshold_van_5m3" type="number" min="1" step="1" value="${config.pallet.vehicleThresholds.van_5m3}" />
        </label>
        <label class="field">
          <span>10m3 Max Pallets</span>
          <input name="palletThreshold_van_10m3" type="number" min="1" step="1" value="${config.pallet.vehicleThresholds.van_10m3}" />
        </label>
        <label class="field">
          <span>20m3 Max Pallets</span>
          <input name="palletThreshold_van_20m3" type="number" min="1" step="1" value="${config.pallet.vehicleThresholds.van_20m3}" />
        </label>
      </div>
    `;
  } else if (algo.id === "hours") {
    fieldsMarkup = `
      <div class="form-grid">
        <label class="field">
          <span>Minimum Hours</span>
          <input name="hoursMinimumHours" type="number" min="1" step="1" value="${config.hours.minimumHours}" />
        </label>
        <label class="field">
          <span>Included Km</span>
          <input name="hoursIncludedKm" type="number" min="0" step="1" value="${config.hours.includedKm}" />
        </label>
        ${Object.entries(config.hours.vehicleHourlyRates)
          .map(
            ([vehicleType, rate]) => `
              <label class="field">
                <span>${escapeHtml(labelForVehicle(vehicleType))} / h</span>
                <input name="hoursRate_${vehicleType}" type="number" min="0" step="0.01" value="${rate}" />
              </label>
            `
          )
          .join("")}
      </div>
    `;
  } else {
    fieldsMarkup = `
      <div class="form-grid">
        <label class="field">
          <span>Minimum Drops</span>
          <input name="dropsMinimumDrops" type="number" min="1" step="1" value="${config.drops.minimumDrops}" />
        </label>
        <label class="field">
          <span>Included Km</span>
          <input name="dropsIncludedKm" type="number" min="0" step="1" value="${config.drops.includedKm}" />
        </label>
        ${Object.entries(config.drops.vehicleDropRates)
          .map(
            ([vehicleType, rate]) => `
              <label class="field">
                <span>${escapeHtml(labelForVehicle(vehicleType))} / drop</span>
                <input name="dropsRate_${vehicleType}" type="number" min="0" step="0.01" value="${rate}" />
              </label>
            `
          )
          .join("")}
      </div>
    `;
  }

  content.innerHTML = `
    <p class="eyebrow">Setup Algo</p>
    <h3 class="modal__title">${escapeHtml(algo.title)}</h3>
    <p class="modal__subtitle">${escapeHtml(algo.description)}</p>

    <form id="pricing-algo-form" class="stack">
      <input type="hidden" name="algoId" value="${algo.id}" />
      <section class="form-section">
        <div class="form-section__header">
          <div>
            <p class="eyebrow">${escapeHtml(algo.tag)}</p>
            <h4>${escapeHtml(algo.title)} Setup</h4>
          </div>
        </div>
        ${fieldsMarkup}
      </section>

      <div class="form-actions admin-actions">
        <button class="ghost-button" type="button" data-close-modal="admin-pricing">Cancel</button>
        <button class="solid-button" type="submit">Save ${escapeHtml(algo.title)}</button>
      </div>
    </form>
  `;
}

function renderOpsUserDetailModal() {
  const content = document.querySelector("#ops-user-detail-modal-content");
  if (!content) {
    return;
  }

  const user = state.opsUsers.find((candidate) => candidate.id === state.selectedOpsUserId);
  content.innerHTML = user
    ? `
        <p class="eyebrow">User</p>
        <h3 class="modal__title">${escapeHtml(joinNameParts(user.firstName, user.lastName) || user.email)}</h3>
        <p class="modal__subtitle">Inspect the ops account, team, role, and access status.</p>

        <section class="form-section">
          <div class="detail-list">
            <div class="detail-row"><span>Email</span><strong>${escapeHtml(user.email)}</strong></div>
            <div class="detail-row"><span>Login Password</span><strong>${escapeHtml(user.temporaryPassword || "demo")}</strong></div>
            <div class="detail-row"><span>Role</span><strong>${escapeHtml(labelForOpsRole(user.role))}</strong></div>
            <div class="detail-row"><span>Team</span><strong>${escapeHtml(user.team ?? "Operations")}</strong></div>
            <div class="detail-row"><span>Status</span><strong>${escapeHtml(capitalize(user.status ?? "active"))}</strong></div>
          </div>
        </section>

        <div class="form-actions">
          <button class="ghost-button" type="button" data-close-modal="ops-user-detail">Close</button>
          <button class="ghost-button" type="button" data-action="edit-ops-user" data-ops-user-id="${user.id}">Edit User</button>
          <button class="solid-button" type="button" data-action="delete-ops-user" data-ops-user-id="${user.id}">Delete User</button>
        </div>
      `
    : `<div class="placeholder-card"><div><h3>No user selected</h3><p>Select an ops user from the admin list to inspect it here.</p></div></div>`;
}

function renderComingSoon(title) {
  return `
    <div class="placeholder-card">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>This section has not been wired yet. The operational work is currently in Orders, Drivers, and Optimizer.</p>
      </div>
    </div>
  `;
}

function renderEmptyDetail(title, body) {
  return `
    <div class="detail-card detail-card--empty">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
      </div>
    </div>
  `;
}

function renderWorkspace() {
  const container = document.querySelector("#workspace-content");

  if (!container) {
    return;
  }

  if (state.activeView === "invoices") {
    state.activeView = "orders";
  }

  if (state.activeView === "orders") {
    container.innerHTML = renderOrdersView();
    return;
  }

  if (state.activeView === "drivers") {
    container.innerHTML = renderDriversView();
    return;
  }

  if (state.activeView === "customers") {
    container.innerHTML = renderCustomersView();
    return;
  }

  if (state.activeView === "inbox") {
    container.innerHTML = renderInboxView();
    return;
  }

  if (state.activeView === "recurring-routes") {
    container.innerHTML = renderRecurringRoutesView();
    return;
  }

  if (state.activeView === "optimizer") {
    container.innerHTML = renderOptimizerView();
    return;
  }

  if (state.activeView === "pricing") {
    container.innerHTML = renderPricingView();
    return;
  }

  if (state.activeView === "admin") {
    container.innerHTML = renderAdminView();
    return;
  }

  container.innerHTML = renderComingSoon("Workspace");
}

function handleOptimizerTimeSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const field = state.optimizerTimeField;
  if (!field) {
    return;
  }

  state.optimizerSetup[field] = form.elements.optimizerTimeValue.value || state.optimizerSetup[field];
  closeModal("optimizer-time");
  render();
}

async function handleInboxReplySubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const body = form.elements.body.value.trim();
  const threadId = form.elements.threadId.value;
  const audience = form.elements.audience.value;

  if (!body) {
    showToast("Write a message first.", "error");
    return;
  }

  const author =
    state.currentUser?.firstName || state.currentUser?.lastName
      ? joinNameParts(state.currentUser?.firstName, state.currentUser?.lastName)
      : "Naaval Ops";

  const message = {
    id: createId("msg"),
    audience,
    threadId,
    author,
    body,
    time: createTimeLabel(new Date().toISOString()),
    mine: true,
    senderType: "ops",
    senderId: state.currentUser?.id ?? "ops_user_pierre",
    createdAt: new Date().toISOString()
  };

  try {
    if (state.apiAvailable) {
      const savedMessage = await postJson("/inbox/messages", message);
      state.inboxMessages = [...state.inboxMessages, savedMessage];
    } else {
      state.inboxMessages = [...state.inboxMessages, message];
      if (localDb) {
        localDb.inboxMessages = [...(localDb.inboxMessages ?? []), message];
      }
    }

    form.reset();
    render();
    showToast("Message sent.");
  } catch (error) {
    showToast(`Unable to send message: ${error.message}`, "error");
  }
}

async function ensureSelectedRouteGeometry() {
  if (state.activeView !== "optimizer" || state.activeOptimizerStage !== "routes" || !state.selectedOptimizerRouteId) {
    return;
  }

  const routeId = state.selectedOptimizerRouteId;
  if (state.routeGeometryByRouteId?.[routeId] || state.routeGeometryLoadingIds.includes(routeId)) {
    return;
  }

  state.routeGeometryLoadingIds = [...state.routeGeometryLoadingIds, routeId];

  try {
    const geometry = await fetchJson(`/routes/${routeId}/geometry`);
    state.routeGeometryByRouteId = {
      ...state.routeGeometryByRouteId,
      [routeId]: geometry
    };
    await refreshGraphhopperUsage({ rerender: false });
    render();
  } catch (_error) {
    state.routeGeometryByRouteId = {
      ...state.routeGeometryByRouteId,
      [routeId]: {
        routeId,
        source: "fallback",
        coordinates: []
      }
    };
  } finally {
    state.routeGeometryLoadingIds = state.routeGeometryLoadingIds.filter((candidate) => candidate !== routeId);
  }
}

function render() {
  document.querySelector(".main")?.classList.toggle("main--pricing", state.activeView === "pricing");
  document.querySelector(".main")?.classList.toggle("main--orders-summary", state.activeView === "orders");
  document.querySelector(".main")?.classList.toggle("main--optimizer", state.activeView === "optimizer");
  const heroName = document.querySelector(".hero__title span");
  if (heroName) {
    heroName.textContent = state.currentUser?.firstName || state.currentUser?.name?.split(" ")[0] || "Pierre";
  }
  renderNav();
  renderMetrics();
  renderPanelHeader();
  renderToolbar();
  renderWorkspace();
  renderOrderDetailModal();
  renderDriverDetailModal();
  renderCustomerDetailModal();
  renderOpsUserDetailModal();
  renderRecurringRouteDetailModal();
  renderAdminPricingModalForm();
  renderOptimizerTimeModal();
  ensureGraphhopperUsageLoaded();
  void ensureSelectedRouteGeometry();
}

function serializeSkills(input) {
  return String(input ?? "")
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function normalizeCsvHeader(input) {
  return String(input ?? "")
    .trim()
    .replace(/^\ufeff/, "")
    .replaceAll(" ", "")
    .replaceAll("-", "")
    .replaceAll("_", "")
    .toLowerCase();
}

function parseCsv(text) {
  const preview = String(text ?? "").split(/\r?\n/, 3).join("\n");
  const commaCount = (preview.match(/,/g) ?? []).length;
  const semicolonCount = (preview.match(/;/g) ?? []).length;
  const delimiter = semicolonCount > commaCount ? ";" : ",";
  const rows = [];
  let currentValue = "";
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentValue);
      if (currentRow.some((value) => value.trim() !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  currentRow.push(currentValue);
  if (currentRow.some((value) => value.trim() !== "")) {
    rows.push(currentRow);
  }

  return rows;
}

function csvValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return "";
}

function toNumberOrUndefined(value) {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toIntegerOrDefault(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formDateTimeToIso(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function buildAddressFromFields(fields, prefix) {
  const street1 = fields[`${prefix}Street1`].value.trim();
  const label = fields[`${prefix}Label`].value.trim() || street1;
  const contactName = joinNameParts(fields[`${prefix}FirstName`]?.value, fields[`${prefix}LastName`]?.value);
  const city = fields[`${prefix}City`].value.trim();
  const postalCode = fields[`${prefix}PostalCode`].value.trim();
  const countryCode = fields[`${prefix}CountryCode`].value.trim() || "FR";
  const phone = fields[`${prefix}Phone`]?.value.trim() || "";
  const email = fields[`${prefix}Email`]?.value.trim() || "";
  const parcelSize = fields[`${prefix}ParcelSize`]?.value || "M";
  const comment = fields[`${prefix}Comment`]?.value.trim() || "";
  const lat = fields[`${prefix}Lat`]?.value ?? "";
  const lon = fields[`${prefix}Lon`]?.value ?? "";

  if (!street1) {
    return null;
  }

  return {
    label,
    street1,
    city,
    postalCode,
    countryCode,
    contactName,
    phone,
    email,
    parcelSize,
    comment,
    coordinates:
      lat && lon
        ? {
            lat: Number.parseFloat(lat),
            lon: Number.parseFloat(lon)
          }
        : undefined
  };
}

function buildDropoffAddressFromFields(fields, index) {
  const street1 = fields[`dropoffStreet1_${index}`]?.value.trim();
  const label = fields[`dropoffLabel_${index}`]?.value.trim() || street1;
  const contactName = joinNameParts(fields[`dropoffFirstName_${index}`]?.value, fields[`dropoffLastName_${index}`]?.value);
  const city = fields[`dropoffCity_${index}`]?.value.trim() || "Paris";
  const postalCode = fields[`dropoffPostalCode_${index}`]?.value.trim() || "";
  const countryCode = fields[`dropoffCountryCode_${index}`]?.value.trim() || "FR";
  const phone = fields[`dropoffPhone_${index}`]?.value.trim() || "";
  const email = fields[`dropoffEmail_${index}`]?.value.trim() || "";
  const parcelSize = fields[`dropoffParcelSize_${index}`]?.value || "M";
  const comment = fields[`dropoffComment_${index}`]?.value.trim() || "";

  if (!street1) {
    return null;
  }

  return {
    label,
    street1,
    city,
    postalCode,
    countryCode,
    contactName,
    phone,
    email,
    parcelSize,
    comment
  };
}

function buildAddressFromCsvRow(row, prefix) {
  const isDropoff = prefix === "dropoff";
  const label = csvValue(
    row,
    isDropoff
      ? [`${prefix}label`, `${prefix}name`, "customer", "client", "recipient", "fullname", "name", "dropofflabel", "deliverylabel"]
      : [`${prefix}label`, `${prefix}name`, "pickup", "pickupname", "warehouse", "hub", "depot", "origin"]
  ).trim();
  const street1 = csvValue(
    row,
    isDropoff
      ? [`${prefix}street1`, `${prefix}street`, `${prefix}address`, "address", "street1", "street", "deliveryaddress", "destinationaddress", "dropoff", "delivery", "destination"]
      : [`${prefix}street1`, `${prefix}street`, `${prefix}address`, "pickupaddress", "warehouseaddress", "hubaddress", "depotaddress", "pickup", "origin"]
  ).trim();
  const contactName = csvValue(
    row,
    isDropoff
      ? [`${prefix}contactname`, `${prefix}contact`, `${prefix}fullname`, "contactname", "contact", "recipient", "fullname"]
      : [`${prefix}contactname`, `${prefix}contact`, `${prefix}fullname`, "pickupcontactname", "pickupcontact", "warehousecontact"]
  ).trim();
  const city = csvValue(row, isDropoff ? [`${prefix}city`, "city"] : [`${prefix}city`, "pickupcity", "hubcity"]).trim();
  const postalCode = csvValue(row, isDropoff ? [`${prefix}postalcode`, `${prefix}zip`, `${prefix}zipcode`, "postalcode", "zip", "zipcode"] : [`${prefix}postalcode`, `${prefix}zip`, `${prefix}zipcode`, "pickuppostalcode", "pickupzip"]).trim();
  const countryCode = csvValue(row, isDropoff ? [`${prefix}countrycode`, `${prefix}country`, "countrycode", "country"] : [`${prefix}countrycode`, `${prefix}country`, "pickupcountrycode", "pickupcountry"]).trim() || "FR";
  const phone = csvValue(row, isDropoff ? [`${prefix}phone`, `${prefix}telephone`, "phone", "telephone", "mobile"] : [`${prefix}phone`, `${prefix}telephone`, "pickupphone", "warehousephone"]).trim();
  const email = csvValue(row, isDropoff ? [`${prefix}email`, `${prefix}mail`, "email", "mail"] : [`${prefix}email`, `${prefix}mail`, "pickupemail", "warehouseemail"]).trim();
  const parcelSize = csvValue(row, isDropoff ? [`${prefix}parcelsize`, `${prefix}size`, "parcelsize", "size"] : [`${prefix}parcelsize`, `${prefix}size`, "pickupparcelsize"]).trim() || "M";
  const comment = csvValue(row, isDropoff ? [`${prefix}comment`, `${prefix}comments`, `${prefix}note`, "comment", "comments", "note"] : [`${prefix}comment`, `${prefix}comments`, `${prefix}note`, "pickupcomment", "pickupnote"]).trim();
  const lat = toNumberOrUndefined(csvValue(row, isDropoff ? [`${prefix}lat`, `${prefix}latitude`, "lat", "latitude"] : [`${prefix}lat`, `${prefix}latitude`, "pickuplat", "pickuplatitude"]));
  const lon = toNumberOrUndefined(csvValue(row, isDropoff ? [`${prefix}lon`, `${prefix}lng`, `${prefix}longitude`, "lon", "lng", "longitude"] : [`${prefix}lon`, `${prefix}lng`, `${prefix}longitude`, "pickuplon", "pickuplng", "pickuplongitude"]));

  if (!street1) {
    return null;
  }

  return {
    label: label || street1,
    street1,
    city: city || "Paris",
    postalCode: postalCode || "75011",
    countryCode,
    contactName,
    phone,
    email,
    parcelSize,
    comment,
    coordinates:
      lat !== undefined && lon !== undefined
        ? {
            lat,
            lon
          }
        : undefined
  };
}

function toMerchantIdentifier(value, fallback = "merchant_demo") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function buildDefaultPickupAddressFromOptimizerSetup() {
  const raw = String(state.optimizerSetup?.pickupAddress || state.hubs[0]?.address || "").trim();
  if (!raw) {
    return null;
  }

  const [street1Part, cityPart = ""] = raw.split(",");
  const street1 = street1Part?.trim() || raw;
  const postalCodeMatch = cityPart.match(/\b\d{4,5}\b/);
  const postalCode = postalCodeMatch?.[0] || (state.hubs[0]?.postalCode ?? "75011");
  const city = cityPart.replace(postalCode, "").trim() || state.hubs[0]?.city || "Paris";

  return {
    label: state.hubs[0]?.label || "Default pickup",
    street1,
    city,
    postalCode,
    countryCode: "FR",
    parcelSize: state.optimizerSetup?.parcelSize || "M",
    comment: ""
  };
}

function buildOrderPayloadFromCsvRow(row) {
  const reference = csvValue(row, ["reference", "orderreference", "externalreference"]).trim();
  const dropoffAddress = buildAddressFromCsvRow(row, "dropoff");

  if (!reference) {
    throw new Error("reference is required");
  }

  if (!dropoffAddress) {
    throw new Error(`row ${reference} is missing a dropoff address`);
  }

  const pickupAddress = buildAddressFromCsvRow(row, "pickup") || buildDefaultPickupAddressFromOptimizerSetup();
  const timeWindowStart = formDateTimeToIso(csvValue(row, ["timewindowstart", "windowstart", "slotstart"]).trim());
  const timeWindowEnd = formDateTimeToIso(csvValue(row, ["timewindowend", "windowend", "slotend"]).trim());
  const explicitKind = csvValue(row, ["kind", "type"]).trim();
  const kind = explicitKind || (pickupAddress ? "pickup_delivery" : "delivery");
  const customerName = csvValue(row, ["customer", "client", "company", "companyname", "merchant", "merchantname"]).trim();
  const merchantId = csvValue(row, ["merchantid", "merchant"]).trim() || toMerchantIdentifier(customerName || dropoffAddress.label, "merchant_demo");
  const hubId = csvValue(row, ["hubid", "hub"]).trim() || getDefaultHubId();

  return {
    merchantId,
    hubId,
    kind,
    reference,
    pickupAddress,
    dropoffAddress,
    parcelSize: dropoffAddress.parcelSize ?? pickupAddress?.parcelSize ?? "M",
    serviceDurationSeconds: toIntegerOrDefault(csvValue(row, ["servicedurationseconds", "serviceduration"]), 300),
    parcelCount: toIntegerOrDefault(csvValue(row, ["parcelcount", "parcels"]), 1),
    weightKg: toNumberOrUndefined(csvValue(row, ["weightkg", "weight"])) ?? 0,
    volumeDm3: toNumberOrUndefined(csvValue(row, ["volumedm3", "volume"])) ?? 0,
    requiredSkills: serializeSkills(csvValue(row, ["requiredskills", "skills"])),
    notes: csvValue(row, ["notes", "note", "instructions"]).trim(),
    timeWindows:
      timeWindowStart && timeWindowEnd
        ? [
            {
              start: timeWindowStart,
              end: timeWindowEnd
            }
          ]
        : []
  };
}

function mapCsvRowsToOrders(text) {
  const rows = parseCsv(text);

  if (rows.length < 2) {
    throw new Error("the CSV must contain a header row and at least one data row");
  }

  const headers = rows[0].map((header) => normalizeCsvHeader(header));
  const dataRows = rows.slice(1);

  return dataRows.map((cells, index) => {
    const rowObject = {};
    headers.forEach((header, columnIndex) => {
      rowObject[header] = (cells[columnIndex] ?? "").trim();
    });

    try {
      return buildOrderPayloadFromCsvRow(rowObject);
    } catch (error) {
      throw new Error(`CSV line ${index + 2}: ${error.message}`);
    }
  });
}

async function handleOrderSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const fields = form.elements;
  const reference = fields.reference.value.trim() || `NAAV-${Date.now().toString().slice(-4)}`;
  const pickupAddress = buildAddressFromFields(fields, "pickup");
  const dropoffCards = [...form.querySelectorAll(".dropoff-card")];
  const dropoffAddresses = dropoffCards
    .map((card) => Number.parseInt(card.getAttribute("data-drop-index"), 10))
    .map((index) => buildDropoffAddressFromFields(fields, index))
    .filter(Boolean);

  if (!pickupAddress) {
    showToast("Pickup address is required.", "error");
    return;
  }

  if (dropoffAddresses.length === 0) {
    showToast("At least one dropoff address is required.", "error");
    return;
  }

  const timeWindowStart = formDateTimeToIso(fields.timeWindowStart.value);
  const timeWindowEnd = formDateTimeToIso(fields.timeWindowEnd.value);
  const basePayload = {
    merchantId: fields.merchantId.value.trim(),
    hubId: fields.hubId.value.trim() || null,
    kind: fields.kind.value,
    pricingAlgorithmId: fields.pricingAlgorithmId.value,
    pickupAddress,
    serviceDurationSeconds: Number.parseInt(fields.serviceDurationSeconds?.value || "300", 10),
    parcelCount: Number.parseInt(fields.parcelCount?.value || "1", 10),
    weightKg: Number.parseFloat(fields.weightKg?.value || "0"),
    volumeDm3: Number.parseFloat(fields.volumeDm3?.value || "0"),
    requiredSkills: serializeSkills(fields.requiredSkills?.value || ""),
    notes: fields.notes?.value?.trim?.() || "",
    parcelSize: pickupAddress.parcelSize ?? "M",
    timeWindows:
      timeWindowStart && timeWindowEnd
        ? [
            {
              start: timeWindowStart,
              end: timeWindowEnd
            }
          ]
        : []
  };

  const payloads = dropoffAddresses.map((dropoffAddress, index) => ({
    ...basePayload,
    reference: dropoffAddresses.length > 1 ? `${reference}-D${index + 1}` : reference,
    kind: index === 0 ? fields.kind.value : "delivery",
    dropoffAddress,
    parcelSize: dropoffAddress.parcelSize ?? basePayload.parcelSize
  }));

  try {
    if (state.apiAvailable) {
      const createdOrders = [];
      for (const payload of payloads) {
        const createdOrder = await postJson("/orders", payload);
        createdOrders.push(createdOrder);
      }
      state.selectedOrderId = createdOrders[0]?.id ?? null;
      state.activeView = "orders";
      await refreshData();
      showToast(`${createdOrders.length} order(s) created in core-api.`);
    } else {
      const timestamp = new Date().toISOString();
      const createdOrders = payloads.map((payload) => ({
        id: createId("ord"),
        ...payload,
        status: "ready",
        createdAt: timestamp,
        updatedAt: timestamp
      }));
      localDb.orders.unshift(...createdOrders);
      state.selectedOrderId = createdOrders[0]?.id ?? null;
      state.activeView = "orders";
      loadFromLocal();
      ensureSelections();
      render();
      showToast(`${createdOrders.length} order(s) created in local prototype mode.`);
    }

    form.reset();
    document.querySelector("#dropoff-list").innerHTML = "";
    syncFormDefaults();
    closeModal("order");
  } catch (error) {
    showToast(`Unable to create order: ${error.message}`, "error");
  }
}

function buildRecurringTemplateOrders(baseReference, basePayload, dropoffAddresses, pickupTimeLabel) {
  return dropoffAddresses.map((dropoffAddress, index) => ({
    id: createId("rr_order"),
    reference: dropoffAddresses.length > 1 ? `${baseReference}-D${index + 1}` : baseReference,
    dropoffLabel: toAddressLabel(dropoffAddress),
    timeLabel: pickupTimeLabel,
    status: "planned",
    pickupAddress: basePayload.pickupAddress,
    dropoffAddress,
    pricingAlgorithmId: basePayload.pricingAlgorithmId,
    kind: index === 0 ? basePayload.kind : "delivery"
  }));
}

function buildRecurringRoutePayloadFromForm(form) {
  const fields = form.elements;
  const pickupAddress = buildAddressFromFields(fields, "pickup");
  const dropoffCards = [...form.querySelectorAll(".dropoff-card")];
  const dropoffAddresses = dropoffCards
    .map((card) => Number.parseInt(card.getAttribute("data-drop-index"), 10))
    .map((index) => buildDropoffAddressFromFields(fields, index))
    .filter(Boolean);

  if (!pickupAddress) {
    throw new Error("Pickup address is required.");
  }

  if (dropoffAddresses.length === 0) {
    throw new Error("At least one dropoff address is required.");
  }

  const recurringDays = String(fields.recurringDays.value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (recurringDays.length === 0) {
    throw new Error("Select at least one recurring day.");
  }

  const pickupTime = fields.recurringPickupTime.value;
  if (!pickupTime) {
    throw new Error("Pickup time is required.");
  }

  const reference = fields.reference.value.trim() || `RR-${Date.now().toString().slice(-6)}`;
  const label = fields.recurringLabel.value.trim() || reference;
  const pickupTimeLabel = pickupTime.replace(":", "h");
  const basePayload = {
    merchantId: fields.merchantId.value.trim(),
    hubId: fields.hubId.value.trim() || getDefaultHubId(),
    kind: fields.kind.value,
    pricingAlgorithmId: fields.pricingAlgorithmId.value,
    pickupAddress,
    note: fields.notes.value.trim(),
    pickupTime
  };
  const orders = buildRecurringTemplateOrders(reference, basePayload, dropoffAddresses, pickupTimeLabel);
  const hubLabel = state.hubs.find((hub) => hub.id === basePayload.hubId)?.label ?? "Central Hub";

  return {
    id: createId("rr"),
    reference,
    label,
    source: "manual",
    recurringDays,
    frequency: formatRecurringDays(recurringDays),
    pickupTime,
    windowLabel: `${pickupTimeLabel} pickup`,
    nextRunLabel: getRecurringNextRunLabel(recurringDays, pickupTime),
    hubId: basePayload.hubId,
    hubLabel,
    merchantId: basePayload.merchantId,
    kind: basePayload.kind,
    pricingAlgorithmId: basePayload.pricingAlgorithmId,
    pickupAddress,
    dropoffAddresses,
    driverName: "Unassigned",
    vehicleLabel: "Pending assignment",
    stopCount: orders.length,
    customerCount: new Set(orders.map((order) => order.dropoffLabel)).size,
    status: "planned",
    tags: [
      `🔁 ${formatRecurringDays(recurringDays)}`,
      `⏱️ ${pickupTimeLabel}`,
      `⚙️ ${getAlgorithmLabel(basePayload.pricingAlgorithmId)}`
    ],
    note: basePayload.note || "Recurring delivery template created from ops.",
    orders,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function handleRecurringRouteSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;

  try {
    const payload = buildRecurringRoutePayloadFromForm(form);
    state.activeView = "recurring-routes";
    state.selectedRecurringRouteId = payload.id;

    if (state.apiAvailable) {
      await postJson("/recurring-routes", payload);
      await refreshData();
    } else {
      if (!localDb) {
        localDb = buildFallbackDb();
      }

      localDb.recurringRoutes = [payload, ...(localDb.recurringRoutes ?? []).filter((route) => route.id !== payload.id)];
      loadFromLocal();
      ensureSelections();
    }

    form.reset();
    document.querySelector("#recurring-dropoff-list").innerHTML = "";
    syncFormDefaults();
    closeModal("recurring-route");
    render();
    showToast(`Recurring delivery ${payload.label} created.`);
  } catch (error) {
    showToast(`Unable to create recurring delivery: ${error.message}`, "error");
  }
}

async function deleteRecurringRoute(routeId) {
  const route = state.recurringRoutes.find((candidate) => candidate.id === routeId);
  if (!route) {
    showToast("Recurring delivery not found.", "error");
    return;
  }

  try {
    if (state.apiAvailable) {
      await deleteJson(`/recurring-routes/${routeId}`);
      await refreshData();
    } else {
      if (!localDb) {
        localDb = buildFallbackDb();
      }

      const current = localDb.recurringRoutes ?? [];
      const existingManual = current.find((item) => item.id === routeId && !item.suppressed);
      if (existingManual) {
        localDb.recurringRoutes = current.filter((item) => item.id !== routeId);
      } else {
        localDb.recurringRoutes = [
          { id: routeId, suppressed: true, source: "generated", updatedAt: new Date().toISOString() },
          ...current.filter((item) => item.id !== routeId)
        ];
      }

      loadFromLocal();
      ensureSelections();
      render();
    }

    if (state.selectedRecurringRouteId === routeId) {
      closeModal("recurring-route-detail");
    }

    showToast(`Recurring delivery ${route.label} deleted.`);
  } catch (error) {
    showToast(`Unable to delete recurring delivery: ${error.message}`, "error");
  }
}

async function importOrdersPayloads(payloads, fileName) {
  if (payloads.length === 0) {
    throw new Error("no valid order rows found in the CSV");
  }

  if (state.apiAvailable) {
    const ordersByMerchant = payloads.reduce((groups, payload) => {
      const merchantId = payload.merchantId || "merchant_demo";
      if (!groups.has(merchantId)) {
        groups.set(merchantId, []);
      }

      groups.get(merchantId).push(payload);
      return groups;
    }, new Map());

    let created = 0;
    const importedIds = [];

    for (const [merchantId, orders] of ordersByMerchant.entries()) {
      const result = await postJson("/orders/import", {
        merchantId,
        orders
      });
      created += result.imported ?? orders.length;
      importedIds.push(...(result.items ?? []).map((item) => item.id).filter(Boolean));
    }

    state.activeView = "optimizer";
    state.activeOptimizerStage = "orders";
    state.selectedPlanningOrderIds = importedIds;
    state.lastImportSummary = {
      fileName,
      created
    };
    await refreshData();
    showToast(`${created} order(s) imported from ${fileName}.`);
    return;
  }

  const timestamp = new Date().toISOString();
  const createdOrders = payloads.map((payload) => ({
    id: createId("ord"),
    ...payload,
    status: "ready",
    createdAt: timestamp,
    updatedAt: timestamp
  }));

  localDb.orders.unshift(...createdOrders);
  state.activeView = "optimizer";
  state.activeOptimizerStage = "orders";
  state.selectedPlanningOrderIds = createdOrders.map((order) => order.id);
  state.lastImportSummary = {
    fileName,
    created: createdOrders.length
  };
  loadFromLocal();
  ensureSelections();
  render();
  showToast(`${createdOrders.length} order(s) imported locally from ${fileName}.`);
}

async function handleCsvImport(event) {
  const file = event.currentTarget.files?.[0];

  if (!file) {
    return;
  }

  if (file.name.toLowerCase().endsWith(".numbers")) {
    showToast("Numbers files are not imported directly. Export the sheet as CSV first, then import that CSV into the VRP.", "error");
    event.currentTarget.value = "";
    return;
  }

  try {
    const text = await file.text();
    const payloads = mapCsvRowsToOrders(text);
    await importOrdersPayloads(payloads, file.name);
  } catch (error) {
    showToast(`CSV import failed: ${error.message}`, "error");
  } finally {
    event.currentTarget.value = "";
  }
}

async function handleDriverSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const editingDriverId = form.elements.driverId?.value.trim() || "";
  const existingDriver = editingDriverId ? state.drivers.find((candidate) => candidate.id === editingDriverId) : null;

  try {
    const firstName = form.elements.firstName.value.trim();
    const lastName = form.elements.lastName.value.trim();
    const name = joinNameParts(firstName, lastName);

    if (!name) {
      showToast("Driver name is required.", "error");
      return;
    }

    const vehiclePhotoUrls = await Promise.all(
      [...(form.elements.vehiclePhotos.files ?? [])].map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
            reader.readAsDataURL(file);
          })
      )
    );
    const mergedVehiclePhotoUrls =
      vehiclePhotoUrls.length > 0 ? [...(existingDriver?.vehiclePhotoUrls ?? []), ...vehiclePhotoUrls] : [...(existingDriver?.vehiclePhotoUrls ?? [])];

    const carrierCompanyDraft = {
      name: form.elements.carrierCompanyName.value.trim(),
      legalName: form.elements.carrierCompanyLegalName.value.trim(),
      email: form.elements.carrierCompanyEmail.value.trim(),
      phone: form.elements.carrierCompanyPhone.value.trim()
    };

    let carrierCompanyId = form.elements.carrierCompanyId.value.trim() || null;

    async function createCarrierCompanyIfNeeded() {
      if (!carrierCompanyDraft.name) {
        return carrierCompanyId;
      }

      const payload = {
        ...carrierCompanyDraft,
        legalName: carrierCompanyDraft.legalName || carrierCompanyDraft.name
      };

      if (state.apiAvailable) {
        const company = await postJson("/fleet/carrier-companies", payload);
        return company.id;
      }

      const company = {
        id: createId("carrier"),
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      localDb.carrierCompanies.unshift(company);
      return company.id;
    }

    carrierCompanyId = await createCarrierCompanyIfNeeded();

    const payload = {
      name,
      firstName,
      lastName,
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      skills: serializeSkills(form.elements.skills.value),
      vehicleType: form.elements.vehicleType.value,
      vehiclePhotoUrls: mergedVehiclePhotoUrls,
      carrierCompanyId,
      status: existingDriver?.rawStatus ?? "active"
    };

    if (state.apiAvailable) {
      const savedDriver = editingDriverId ? await patchJson(`/fleet/drivers/${editingDriverId}`, payload) : await postJson("/fleet/drivers", payload);
      state.selectedDriverId = savedDriver.id;
      state.activeView = "drivers";
      await refreshData();
      showToast(`Driver ${payload.name} ${editingDriverId ? "updated" : "created"} in core-api.`);
    } else {
      const savedDriver = editingDriverId
        ? {
            ...(localDb.drivers.find((candidate) => candidate.id === editingDriverId) ?? {}),
            id: editingDriverId,
            ...payload,
            status: existingDriver?.rawStatus ?? "active",
            updatedAt: new Date().toISOString()
          }
        : {
            id: createId("driver"),
            ...payload,
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
      if (editingDriverId) {
        localDb.drivers = (localDb.drivers ?? []).map((candidate) => (candidate.id === editingDriverId ? savedDriver : candidate));
      } else {
        localDb.drivers.unshift(savedDriver);
      }
      state.selectedDriverId = savedDriver.id;
      state.activeView = "drivers";
      loadFromLocal();
      ensureSelections();
      render();
      showToast(`Driver ${payload.name} ${editingDriverId ? "updated" : "created"} in local prototype mode.`);
    }

    form.reset();
    closeModal("driver");
  } catch (error) {
    showToast(`Unable to ${editingDriverId ? "update" : "create"} driver: ${error.message}`, "error");
  }
}

async function handleCarrierCompanySubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const payload = {
    name: form.elements.name.value.trim(),
    legalName: form.elements.legalName.value.trim() || form.elements.name.value.trim(),
    email: form.elements.email.value.trim(),
    phone: form.elements.phone.value.trim(),
    headquartersAddress: form.elements.headquartersAddress.value.trim(),
    vatNumber: form.elements.vatNumber.value.trim(),
    contactFirstName: form.elements.contactFirstName.value.trim(),
    contactLastName: form.elements.contactLastName.value.trim(),
    contactPhone: form.elements.contactPhone.value.trim(),
    contactEmail: form.elements.contactEmail.value.trim(),
    tags: serializeSkills(form.elements.tags.value)
  };

  if (!payload.name) {
    showToast("Carrier company name is required.", "error");
    return;
  }

  try {
    let createdCompany;

    if (state.apiAvailable) {
      createdCompany = await postJson("/fleet/carrier-companies", payload);
      state.pendingCarrierCompanyId = createdCompany.id;
      await refreshData();
    } else {
      createdCompany = {
        id: createId("carrier"),
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      localDb.carrierCompanies.unshift(createdCompany);
      state.pendingCarrierCompanyId = createdCompany.id;
      loadFromLocal();
      ensureSelections();
      syncFormDefaults();
      render();
    }

    form.reset();
    closeModal("carrier-company");
    showToast(`Carrier company ${payload.name} created.`);
  } catch (error) {
    showToast(`Unable to create carrier company: ${error.message}`, "error");
  }
}

async function handleOpsUserSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const editingUserId = form.elements.userId?.value.trim() || "";
  const payload = {
    firstName: form.elements.firstName.value.trim(),
    lastName: form.elements.lastName.value.trim(),
    email: form.elements.email.value.trim(),
    role: form.elements.role.value,
    team: form.elements.team.value.trim() || "Operations",
    temporaryPassword: form.elements.temporaryPassword.value.trim() || "demo",
    status: "active"
  };

  if (!payload.firstName || !payload.lastName || !payload.email) {
    showToast("First name, last name, and email are required.", "error");
    return;
  }

  try {
    let savedUser = null;
    if (state.apiAvailable) {
      if (editingUserId) {
        savedUser = await patchJson(`/admin/users/${editingUserId}`, payload);
      } else {
        savedUser = await postJson("/admin/users", payload);
      }
      await refreshData();
    } else {
      savedUser = editingUserId
        ? {
            ...(localDb.opsUsers.find((candidate) => candidate.id === editingUserId) ?? {}),
            id: editingUserId,
            ...payload,
            updatedAt: new Date().toISOString()
          }
        : {
            id: createId("ops_user"),
            ...payload,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
      if (editingUserId) {
        localDb.opsUsers = (localDb.opsUsers ?? []).map((candidate) => (candidate.id === editingUserId ? savedUser : candidate));
      } else {
        localDb.opsUsers.unshift(savedUser);
      }
      loadFromLocal();
      ensureSelections();
      render();
    }

    form.reset();
    state.editingOpsUserId = null;
    state.selectedOpsUserId = savedUser?.id ?? editingUserId || state.selectedOpsUserId;
    render();
    showToast(`Ops user ${payload.firstName} ${editingUserId ? "updated" : "created"}. Login: ${payload.email} / ${payload.temporaryPassword}`);
  } catch (error) {
    showToast(`Unable to ${editingUserId ? "update" : "create"} ops user: ${error.message}`, "error");
  }
}

async function deleteOpsUser(userId) {
  const user = state.opsUsers.find((candidate) => candidate.id === userId);
  if (!user) {
    showToast("Ops user not found.", "error");
    return;
  }

  try {
    if (state.apiAvailable) {
      await deleteJson(`/admin/users/${userId}`);
      await refreshData();
    } else {
      localDb.opsUsers = (localDb.opsUsers ?? []).filter((candidate) => candidate.id !== userId);
      loadFromLocal();
      ensureSelections();
      render();
    }

    if (state.selectedOpsUserId === userId) {
      closeModal("ops-user-detail");
    }
    if (state.editingOpsUserId === userId) {
      state.editingOpsUserId = null;
    }

    showToast(`Ops user ${joinNameParts(user.firstName, user.lastName) || user.email} deleted.`);
  } catch (error) {
    showToast(`Unable to delete ops user: ${error.message}`, "error");
  }
}

async function handleCustomerSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const editingCustomerId = form.elements.customerId?.value.trim() || "";
  const existingAccountCustomer = editingCustomerId ? state.accountCustomers.find((candidate) => candidate.id === editingCustomerId) : null;
  const payload = {
    ...(editingCustomerId ? { id: editingCustomerId } : {}),
    companyName: form.elements.companyName.value.trim(),
    headquartersAddress: form.elements.headquartersAddress.value.trim(),
    vatNumber: form.elements.vatNumber.value.trim(),
    companyPhone: form.elements.companyPhone.value.trim(),
    companyEmail: form.elements.companyEmail.value.trim(),
    contactFirstName: form.elements.contactFirstName.value.trim(),
    contactLastName: form.elements.contactLastName.value.trim(),
    contactPhone: form.elements.contactPhone.value.trim(),
    contactEmail: form.elements.contactEmail.value.trim(),
    revenueRange: form.elements.revenueRange.value,
    companySize: form.elements.companySize.value,
    pricingAlgorithmId: form.elements.pricingAlgorithmId.value
  };

  if (!payload.companyName || !payload.headquartersAddress) {
    showToast("Company name and headquarters address are required.", "error");
    return;
  }

  try {
    let createdCustomer = null;

    if (state.apiAvailable) {
      createdCustomer = existingAccountCustomer ? await patchJson(`/customers/${editingCustomerId}`, payload) : await postJson("/customers", payload);
      await refreshData();
    } else {
      createdCustomer = editingCustomerId
        ? {
            ...(localDb.customers.find((candidate) => candidate.id === editingCustomerId) ?? {}),
            ...payload,
            id: editingCustomerId,
            updatedAt: new Date().toISOString()
          }
        : {
            id: createId("customer"),
            ...payload,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
      if (editingCustomerId) {
        localDb.customers = (localDb.customers ?? []).map((candidate) => (candidate.id === editingCustomerId ? createdCustomer : candidate));
      } else {
        localDb.customers.unshift(createdCustomer);
      }
      loadFromLocal();
      ensureSelections();
      render();
    }

    if (createdCustomer?.id) {
      state.selectedCustomerId = createdCustomer.id;
    }

    form.reset();
    closeModal("customer");
    render();
    showToast(`Customer ${payload.companyName} ${editingCustomerId ? "updated" : "created"}.`);
  } catch (error) {
    showToast(`Unable to ${editingCustomerId ? "update" : "create"} customer: ${error.message}`, "error");
  }
}

async function updateCustomerPricingAlgorithm(customerId, pricingAlgorithmId) {
  const customer = getVisibleCustomers().find((candidate) => candidate.id === customerId) ?? state.customers.find((candidate) => candidate.id === customerId);
  if (!customer) {
    showToast("Customer not found.", "error");
    return;
  }

  const accountCustomer = state.accountCustomers.find((candidate) => candidate.id === customerId);
  const payload = {
    id: accountCustomer?.id ?? customer.id,
    companyName: accountCustomer?.companyName ?? customer.name,
    headquartersAddress: accountCustomer?.headquartersAddress ?? customer.addressLabel,
    vatNumber: accountCustomer?.vatNumber ?? customer.vatNumber ?? "",
    companyPhone: accountCustomer?.companyPhone ?? customer.companyPhone ?? "",
    companyEmail: accountCustomer?.companyEmail ?? customer.companyEmail ?? customer.contactEmail ?? "",
    contactFirstName: accountCustomer?.contactFirstName ?? customer.contactName?.split(" ")[0] ?? "",
    contactLastName: accountCustomer?.contactLastName ?? customer.contactName?.split(" ").slice(1).join(" ") ?? "",
    contactPhone: accountCustomer?.contactPhone ?? customer.contactPhone ?? "",
    contactEmail: accountCustomer?.contactEmail ?? customer.contactEmail ?? "",
    revenueRange: accountCustomer?.revenueRange ?? customer.revenueRange ?? "0-500k",
    companySize: accountCustomer?.companySize ?? customer.companySize ?? "smb",
    pricingAlgorithmId
  };

  try {
    if (state.apiAvailable) {
      if (accountCustomer) {
        await patchJson(`/customers/${payload.id}`, payload);
      } else {
        await postJson("/customers", payload);
      }
      await refreshData();
    } else {
      const target = (localDb.customers ?? []).find((candidate) => candidate.id === payload.id);
      if (target) {
        Object.assign(target, payload, { updatedAt: new Date().toISOString() });
      } else {
        localDb.customers.unshift({
          ...payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      loadFromLocal();
      ensureSelections();
      render();
    }

    showToast(`Default pricing algo set to ${getAlgorithmLabel(pricingAlgorithmId)}.`);
  } catch (error) {
    showToast(`Unable to update customer algo: ${error.message}`, "error");
  }
}

function normalizeLookup(value) {
  return String(value ?? "").trim().toLowerCase();
}

function findExistingCustomerAccount(companyName, companyEmail, contactEmail) {
  return state.accountCustomers.find((customer) => {
    return (
      normalizeLookup(customer.companyName) === normalizeLookup(companyName) ||
      normalizeLookup(customer.companyEmail) === normalizeLookup(companyEmail) ||
      normalizeLookup(customer.contactEmail) === normalizeLookup(contactEmail)
    );
  });
}

async function createOrReuseCustomerAccount(payload) {
  const existing = findExistingCustomerAccount(payload.companyName, payload.companyEmail, payload.contactEmail);
  if (existing) {
    existing.pricingAlgorithmId = existing.pricingAlgorithmId || payload.pricingAlgorithmId || "basic";
    return existing;
  }

  if (state.apiAvailable) {
    return await postJson("/customers", payload);
  }

  if (!localDb) {
    localDb = buildFallbackDb();
  }

  const customer = {
    id: createId("customer"),
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  localDb.customers.unshift(customer);
  return customer;
}

async function createQuoteRecord(payload) {
  if (state.apiAvailable) {
    return await postJson("/quotes", payload);
  }

  if (!localDb) {
    localDb = buildFallbackDb();
  }

  const quote = {
    id: createId("quote"),
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  localDb.quotes.unshift(quote);
  return quote;
}

async function handleQuoteSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const fields = form.elements;
  const customerPayload = {
    companyName: fields.companyName.value.trim(),
    headquartersAddress: fields.headquartersAddress.value.trim(),
    vatNumber: fields.vatNumber.value.trim(),
    companyPhone: fields.companyPhone.value.trim(),
    companyEmail: fields.companyEmail.value.trim(),
    contactFirstName: fields.contactFirstName.value.trim(),
    contactLastName: fields.contactLastName.value.trim(),
    contactPhone: fields.contactPhone.value.trim(),
    contactEmail: fields.contactEmail.value.trim(),
    revenueRange: fields.revenueRange.value,
    companySize: fields.companySize.value,
    pricingAlgorithmId: (state.quoteContext ?? getQuoteContextForSource(fields.quoteSource.value)).source
  };

  if (!customerPayload.companyName || !customerPayload.headquartersAddress || !customerPayload.contactEmail) {
    showToast("Company name, HQ address, and contact email are required.", "error");
    return;
  }

  try {
    const customer = await createOrReuseCustomerAccount(customerPayload);
    const context = state.quoteContext ?? getQuoteContextForSource(fields.quoteSource.value);
    const quote = await createQuoteRecord({
      customerId: customer.id,
      source: context.source,
      sourceLabel: context.label,
      description: context.description,
      amount: context.amount,
      currency: "EUR",
      dateKey: state.selectedDate,
      companySnapshot: customerPayload
    });

    const pdfLines = [
      "NAAVAL QUOTE",
      `Quote ID: ${quote.id}`,
      `Date: ${state.selectedDate}`,
      "",
      `Company: ${customerPayload.companyName}`,
      `HQ: ${customerPayload.headquartersAddress}`,
      `VAT: ${customerPayload.vatNumber || "N/A"}`,
      `Company phone: ${customerPayload.companyPhone || "N/A"}`,
      `Company email: ${customerPayload.companyEmail || "N/A"}`,
      `Contact: ${joinNameParts(customerPayload.contactFirstName, customerPayload.contactLastName)}`,
      `Contact phone: ${customerPayload.contactPhone || "N/A"}`,
      `Contact email: ${customerPayload.contactEmail}`,
      `Revenue range: ${customerPayload.revenueRange}`,
      `Company size: ${customerPayload.companySize}`,
      "",
      `Pricing model: ${context.label}`,
      `Scope: ${context.description}`,
      `Quoted amount HT: ${roundPrice(context.amount)} EUR`
    ];

    downloadBlob(buildPdfBlob(pdfLines), `naaval-quote-${customerPayload.companyName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.pdf`);

    if (state.apiAvailable) {
      await refreshData();
    } else {
      loadFromLocal();
      ensureSelections();
      render();
    }

    form.reset();
    closeModal("quote");
    showToast(`Quote created for ${customerPayload.companyName}.`);
  } catch (error) {
    showToast(`Unable to generate quote: ${error.message}`, "error");
  }
}

async function handleQuoteEmailSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const recipientEmail = form.elements.recipientEmail.value.trim();
  const recipientName = form.elements.recipientName.value.trim();
  const context = state.quoteContext ?? getQuoteContextForSource(state.selectedPricingAlgo);

  if (!recipientEmail) {
    showToast("Recipient email is required.", "error");
    return;
  }

  const subject = `Naaval quote - ${context.label}`;
  const greeting = recipientName ? `Bonjour ${recipientName},` : "Bonjour,";
  const body = [
    greeting,
    "",
    `Veuillez trouver ci-dessous l'estimation ${context.label.toLowerCase()} preparee par Naaval.`,
    `Montant estime HT: ${formatCurrency(context.amount)}`,
    `Perimetre: ${context.description}`,
    "",
    "Le PDF de devis a ete genere localement depuis l'interface ops.",
    "",
    "Cordialement,",
    "Naaval Ops"
  ].join("\n");

  window.location.href = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  closeModal("quote-email");
  showToast(`Email draft prepared for ${recipientEmail}.`);
}

function buildPricingConfigFromForm(form) {
  const fields = form.elements;

  return {
    currency: "EUR",
    basic: {
      distanceRatePerKm: clampNumber(fields.basicDistanceRatePerKm.value, 0),
      sizeBasePrices: {
        S: clampNumber(fields.basicSize_S.value, 0),
        M: clampNumber(fields.basicSize_M.value, 0),
        L: clampNumber(fields.basicSize_L.value, 0),
        XL: clampNumber(fields.basicSize_XL.value, 0),
        XXL: clampNumber(fields.basicSize_XXL.value, 0)
      }
    },
    pallet: {
      pricePerPallet: clampNumber(fields.palletPricePerPallet.value, 0),
      vehicleThresholds: {
        van_3m3: clampNumber(fields.palletThreshold_van_3m3.value, 1, 1),
        van_5m3: clampNumber(fields.palletThreshold_van_5m3.value, 1, 1),
        van_10m3: clampNumber(fields.palletThreshold_van_10m3.value, 1, 1),
        van_20m3: clampNumber(fields.palletThreshold_van_20m3.value, 1, 1)
      }
    },
    hours: {
      minimumHours: clampNumber(fields.hoursMinimumHours.value, 1, 1),
      includedKm: clampNumber(fields.hoursIncludedKm.value, 0),
      vehicleHourlyRates: Object.fromEntries(
        Object.keys(getPricingConfig().hours.vehicleHourlyRates).map((vehicleType) => [
          vehicleType,
          clampNumber(fields[`hoursRate_${vehicleType}`].value, 0)
        ])
      )
    },
    drops: {
      minimumDrops: clampNumber(fields.dropsMinimumDrops.value, 1, 1),
      includedKm: clampNumber(fields.dropsIncludedKm.value, 0),
      vehicleDropRates: Object.fromEntries(
        Object.keys(getPricingConfig().drops.vehicleDropRates).map((vehicleType) => [
          vehicleType,
          clampNumber(fields[`dropsRate_${vehicleType}`].value, 0)
        ])
      )
    }
  };
}

function buildPricingConfigFromAlgoForm(form) {
  const fields = form.elements;
  const algoId = fields.algoId.value;
  const config = clone(getPricingConfig());

  if (algoId === "basic") {
    config.basic = {
      distanceRatePerKm: clampNumber(fields.basicDistanceRatePerKm.value, config.basic.distanceRatePerKm),
      sizeBasePrices: {
        S: clampNumber(fields.basicSize_S.value, config.basic.sizeBasePrices.S),
        M: clampNumber(fields.basicSize_M.value, config.basic.sizeBasePrices.M),
        L: clampNumber(fields.basicSize_L.value, config.basic.sizeBasePrices.L),
        XL: clampNumber(fields.basicSize_XL.value, config.basic.sizeBasePrices.XL),
        XXL: clampNumber(fields.basicSize_XXL.value, config.basic.sizeBasePrices.XXL)
      }
    };
    return config;
  }

  if (algoId === "pallet") {
    config.pallet = {
      pricePerPallet: clampNumber(fields.palletPricePerPallet.value, config.pallet.pricePerPallet),
      vehicleThresholds: {
        van_3m3: clampNumber(fields.palletThreshold_van_3m3.value, config.pallet.vehicleThresholds.van_3m3, 1),
        van_5m3: clampNumber(fields.palletThreshold_van_5m3.value, config.pallet.vehicleThresholds.van_5m3, 1),
        van_10m3: clampNumber(fields.palletThreshold_van_10m3.value, config.pallet.vehicleThresholds.van_10m3, 1),
        van_20m3: clampNumber(fields.palletThreshold_van_20m3.value, config.pallet.vehicleThresholds.van_20m3, 1)
      }
    };
    return config;
  }

  if (algoId === "hours") {
    config.hours = {
      minimumHours: clampNumber(fields.hoursMinimumHours.value, config.hours.minimumHours, 1),
      includedKm: clampNumber(fields.hoursIncludedKm.value, config.hours.includedKm),
      vehicleHourlyRates: Object.fromEntries(
        Object.keys(config.hours.vehicleHourlyRates).map((vehicleType) => [
          vehicleType,
          clampNumber(fields[`hoursRate_${vehicleType}`].value, config.hours.vehicleHourlyRates[vehicleType])
        ])
      )
    };
    return config;
  }

  config.drops = {
    minimumDrops: clampNumber(fields.dropsMinimumDrops.value, config.drops.minimumDrops, 1),
    includedKm: clampNumber(fields.dropsIncludedKm.value, config.drops.includedKm),
    vehicleDropRates: Object.fromEntries(
      Object.keys(config.drops.vehicleDropRates).map((vehicleType) => [
        vehicleType,
        clampNumber(fields[`dropsRate_${vehicleType}`].value, config.drops.vehicleDropRates[vehicleType])
      ])
    )
  };

  return config;
}

async function savePricingConfig(config) {
  state.pricingConfig = clone(config);
  ensurePricingState();

  if (state.apiAvailable) {
    const response = await postJson("/pricing/config", config);
    state.pricingConfig = clone(response.config ?? config);
    render();
    return;
  }

  if (!localDb) {
    localDb = buildFallbackDb();
  }

  localDb.pricingConfig = clone(config);
  render();
}

async function handlePricingAdminSubmit(event) {
  event.preventDefault();

  try {
    const config = buildPricingConfigFromForm(event.currentTarget);
    await savePricingConfig(config);
    showToast("Pricing configuration saved.");
  } catch (error) {
    showToast(`Unable to save pricing config: ${error.message}`, "error");
  }
}

async function handlePricingAlgoSubmit(event) {
  event.preventDefault();

  try {
    const config = buildPricingConfigFromAlgoForm(event.currentTarget);
    const algo = getAdminPricingAlgoMeta(event.currentTarget.elements.algoId.value);
    await savePricingConfig(config);
    closeModal("admin-pricing");
    showToast(`${algo.title} configuration saved.`);
  } catch (error) {
    showToast(`Unable to save pricing config: ${error.message}`, "error");
  }
}

async function resetPricingConfig() {
  try {
    await savePricingConfig(buildDefaultPricingConfig());
    showToast("Pricing configuration reset to defaults.");
  } catch (error) {
    showToast(`Unable to reset pricing config: ${error.message}`, "error");
  }
}

function findDriverName(driverId) {
  return state.drivers.find((driver) => driver.id === driverId)?.name ?? driverId ?? "Unassigned";
}

function findShiftForDriver(driverId) {
  return (
    state.shifts
      .filter((shift) => shift.driverId === driverId)
      .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())[0] ?? null
  );
}

function createManualRouteForOrder(orderRecord, driverId) {
  const shift = findShiftForDriver(driverId);
  const routeId = createId("route");
  const shiftStart = shift?.startAt ? new Date(shift.startAt).getTime() : Date.now();
  let currentTime = shiftStart;
  let sequence = 1;
  const stops = [];

  if ((orderRecord.kind === "pickup_delivery" || orderRecord.kind === "return") && orderRecord.pickupAddress) {
    const pickupArrival = new Date(currentTime + 10 * 60 * 1000).toISOString();
    currentTime += 10 * 60 * 1000 + (orderRecord.serviceDurationSeconds ?? 300) * 1000;
    stops.push({
      id: `${routeId}_stop_${sequence}`,
      orderId: orderRecord.id,
      orderIds: [orderRecord.id],
      sequence,
      kind: "pickup",
      address: orderRecord.pickupAddress,
      plannedArrivalAt: pickupArrival,
      plannedDepartureAt: new Date(currentTime).toISOString(),
      status: "pending"
    });
    sequence += 1;
  }

  const deliveryArrival = new Date(currentTime + 15 * 60 * 1000).toISOString();
  currentTime += 15 * 60 * 1000 + (orderRecord.serviceDurationSeconds ?? 300) * 1000;
  stops.push({
    id: `${routeId}_stop_${sequence}`,
    orderId: orderRecord.id,
    orderIds: [orderRecord.id],
    sequence,
    kind: "delivery",
    address: orderRecord.dropoffAddress,
    plannedArrivalAt: deliveryArrival,
    plannedDepartureAt: new Date(currentTime).toISOString(),
    status: "pending"
  });

  return {
    id: routeId,
    planId: createId("manual_plan"),
    shiftId: shift?.id ?? null,
    driverId,
    vehicleId: shift?.vehicleId ?? null,
    status: "ready",
    source: "manual_assignment",
    totalDistanceMeters: stops.length * 3800,
    totalDurationSeconds: Math.round((currentTime - shiftStart) / 1000),
    stops
  };
}

async function assignDriverToOrder(orderId, driverId) {
  if (!driverId) {
    showToast("Select a driver first.", "error");
    return;
  }

  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    showToast("Order not found.", "error");
    return;
  }

  if (!canAssignOrder(order)) {
    showToast("This order can no longer be reassigned from the list.", "error");
    return;
  }

  const driver = state.drivers.find((candidate) => candidate.id === driverId);
  if (driver) {
    state.orderAssignmentFilters[orderId] = driver.carrierCompanyId ?? "";
  }

  try {
    if (state.apiAvailable) {
      await patchJson(`/orders/${orderId}/assignment`, { driverId });
      state.selectedOrderId = orderId;
      await refreshData();
      openModal("order-detail");
      showToast(`Driver assigned to ${order.reference}.`);
      return;
    }

    const localOrder = localDb.orders.find((candidate) => candidate.id === orderId);
    const existingRoute = localDb.routes.find((route) => route.stops?.some((stop) => getStopOrderIds(stop).includes(orderId)));

    if (existingRoute) {
      const shift = findShiftForDriver(driverId);
      existingRoute.driverId = driverId;
      existingRoute.shiftId = shift?.id ?? existingRoute.shiftId ?? null;
      existingRoute.vehicleId = shift?.vehicleId ?? existingRoute.vehicleId ?? null;
      existingRoute.updatedAt = new Date().toISOString();
    } else if (localOrder) {
      localDb.routes.unshift(createManualRouteForOrder(localOrder, driverId));
    }

    if (localOrder) {
      localOrder.status = "planned";
      localOrder.updatedAt = new Date().toISOString();
    }

    state.selectedOrderId = orderId;
    loadFromLocal();
    ensureSelections();
    render();
    openModal("order-detail");
    showToast(`Driver assigned to ${order.reference}.`);
  } catch (error) {
    showToast(`Unable to assign driver: ${error.message}`, "error");
  }
}

function toPlanDate() {
  return state.selectedDate;
}

function getPlanningCandidates() {
  const selectedOrders = getSelectedPlanningOrders().filter((order) => canOrderBePlanned(order));
  const candidateOrders = selectedOrders.length > 0
    ? selectedOrders
    : getVisibleOrders().filter((order) => canOrderBePlanned(order));
  const orderIds = candidateOrders.map((order) => order.id);
  const requestedTruckCount = Math.max(1, Number.parseInt(String(state.optimizerSetup?.trucks ?? state.shifts.length ?? 1), 10) || state.shifts.length || 1);
  const driverShiftIds = state.shifts.slice(0, Math.min(requestedTruckCount, state.shifts.length)).map((shift) => shift.id);

  return {
    orderIds,
    driverShiftIds,
    hubId: getDefaultHubId()
  };
}

function createLocalMockRoutes(planId, orders, shifts) {
  const buckets = shifts.map((shift) => ({
    shift,
    orders: []
  }));

  orders.forEach((order, index) => {
    if (buckets.length === 0) {
      return;
    }

    buckets[index % buckets.length].orders.push(order);
  });

  return buckets
    .filter((bucket) => bucket.orders.length > 0)
    .map((bucket) => {
      const routeId = createId("route");
      let currentTime = new Date(bucket.shift.startAt).getTime();
      let sequence = 1;
      const stops = [];
      const pickupKeys = new Set(
        bucket.orders
          .map((order) =>
            order.pickupAddress
              ? [
                  order.pickupAddress.street1 ?? "",
                  order.pickupAddress.postalCode ?? "",
                  order.pickupAddress.city ?? "",
                  order.pickupAddress.countryCode ?? "",
                  order.pickupCoordinates?.lat ?? "",
                  order.pickupCoordinates?.lon ?? ""
                ].join("|")
              : ""
          )
          .filter(Boolean)
      );

      if (pickupKeys.size === 1 && bucket.orders[0]?.pickupAddress) {
        const pickupArrival = new Date(currentTime + 10 * 60 * 1000).toISOString();
        const pickupDurationSeconds = bucket.orders.reduce((total, order) => total + (order.serviceDurationSeconds ?? 300), 0);
        currentTime += 10 * 60 * 1000 + pickupDurationSeconds * 1000;
        stops.push({
          id: `${routeId}_stop_${sequence}`,
          orderId: bucket.orders[0].id,
          orderIds: bucket.orders.map((order) => order.id),
          sequence,
          kind: "pickup",
          address: bucket.orders[0].pickupAddress,
          plannedArrivalAt: pickupArrival,
          plannedDepartureAt: new Date(currentTime).toISOString(),
          status: "pending"
        });
        sequence += 1;
      }

      for (const order of bucket.orders) {
        if (pickupKeys.size !== 1 && (order.kind === "pickup_delivery" || order.kind === "return") && order.pickupAddress) {
          const pickupArrival = new Date(currentTime + 10 * 60 * 1000).toISOString();
          currentTime += 10 * 60 * 1000 + order.serviceDurationSeconds * 1000;
          stops.push({
            id: `${routeId}_stop_${sequence}`,
            orderId: order.id,
            orderIds: [order.id],
            sequence,
            kind: "pickup",
            address: order.pickupAddress,
            plannedArrivalAt: pickupArrival,
            plannedDepartureAt: new Date(currentTime).toISOString(),
            status: "pending"
          });
          sequence += 1;
        }

        const deliveryArrival = new Date(currentTime + 15 * 60 * 1000).toISOString();
        currentTime += 15 * 60 * 1000 + order.serviceDurationSeconds * 1000;
        stops.push({
          id: `${routeId}_stop_${sequence}`,
          orderId: order.id,
          orderIds: [order.id],
          sequence,
          kind: "delivery",
          address: order.dropoffAddress,
          plannedArrivalAt: deliveryArrival,
          plannedDepartureAt: new Date(currentTime).toISOString(),
          status: "pending"
        });
        sequence += 1;
      }

      return {
        id: routeId,
        planId,
        shiftId: bucket.shift.id,
        driverId: bucket.shift.driverId,
        vehicleId: bucket.shift.vehicleId,
        status: "ready",
        totalDistanceMeters: stops.length * 4300,
        totalDurationSeconds: Math.round((currentTime - new Date(bucket.shift.startAt).getTime()) / 1000),
        stops
      };
    });
}

async function seedDemoData() {
  if (state.apiAvailable) {
    try {
      await postJson("/dev/seed-demo", {
        replace: false,
        planDate: toPlanDate()
      });
      await refreshData();
      showToast("Demo data seeded into core-api.");
    } catch (error) {
      showToast(`Unable to seed demo data: ${error.message}`, "error");
    }
    return;
  }

  localDb = buildFallbackDb();
  loadFromLocal();
  ensureSelections();
  render();
  showToast("Prototype data reset to the demo operational baseline.");
}

async function runPlanning() {
  const planning = getPlanningCandidates();

  if (planning.orderIds.length === 0) {
    showToast(
      state.selectedPlanningOrderIds.length > 0
        ? "No eligible selected orders found for the current day."
        : "No ready unplanned orders found. Create an order or seed demo data first.",
      "error"
    );
    return;
  }

  if (planning.driverShiftIds.length === 0) {
    showToast("No driver shifts configured. Seed demo data to create operational capacity.", "error");
    return;
  }

  if (state.apiAvailable) {
    try {
      state.activeView = "optimizer";
      state.activeOptimizerStage = "routes";
      const solver = state.solverMode === "GraphHopper Ready" ? "graphhopper" : "mock";
      const result = await postJson("/planning/optimize", {
        hubId: planning.hubId,
        planDate: toPlanDate(),
        orderIds: planning.orderIds,
        driverShiftIds: planning.driverShiftIds,
        objectivePreset: getOptimizerObjectivePreset(),
        solver
      });

      await refreshData();
      const solverLabel = result.solver === "graphhopper" ? "GraphHopper" : "Naaval local planner";
      const note = result.note ? ` ${result.note}` : "";
      showToast(`Planning run completed with ${solverLabel}. Job ${result.planningJobId} created.${note}`);
    } catch (error) {
      showToast(`Planning failed: ${error.message}`, "error");
    }
    return;
  }

  const eligibleOrders = localDb.orders.filter((order) => planning.orderIds.includes(order.id));
  const shifts = localDb.shifts.filter((shift) => planning.driverShiftIds.includes(shift.id));
  const planId = createId("plan");
  const routes = createLocalMockRoutes(planId, eligibleOrders, shifts);

  localDb.routes = localDb.routes.filter((route) => route.planId !== planId).concat(routes);
  for (const order of localDb.orders) {
    if (planning.orderIds.includes(order.id)) {
      order.status = "planned";
      order.updatedAt = new Date().toISOString();
    }
  }

  state.activeView = "optimizer";
  state.activeOptimizerStage = "routes";
  loadFromLocal();
  ensureSelections();
  render();
  showToast(`Local planning completed. ${routes.length} route(s) created.`);
}

async function dispatchRoute(routeId) {
  const route = state.routes.find((candidate) => candidate.id === routeId);

  if (!route) {
    showToast("Route not found.", "error");
    return;
  }

  if (state.apiAvailable) {
    try {
      await postJson(`/routes/${routeId}/dispatch`, {
        driverId: route.driverId
      });
      await refreshData();
      showToast(`Route ${routeId} dispatched.`);
    } catch (error) {
      showToast(`Unable to dispatch route: ${error.message}`, "error");
    }
    return;
  }

  for (const localRoute of localDb.routes) {
    if (localRoute.id !== routeId) {
      continue;
    }

    localRoute.status = "dispatched";
    localRoute.dispatchedAt = new Date().toISOString();

    for (const stop of localRoute.stops) {
      for (const orderId of getStopOrderIds(stop)) {
        const order = localDb.orders.find((candidate) => candidate.id === orderId);
        if (order) {
          order.status = "dispatched";
          order.updatedAt = new Date().toISOString();
        }
      }
    }
  }

  loadFromLocal();
  ensureSelections();
  render();
  showToast(`Route ${routeId} dispatched in local prototype mode.`);
}

function exportOrders() {
  const visibleOrders = getVisibleOrders();

  if (visibleOrders.length === 0) {
    showToast("There are no orders to export yet.", "error");
    return;
  }

  const rows = [
    ["reference", "status", "pickup", "dropoff", "courier", "amount"]
  ];

  for (const order of visibleOrders) {
    rows.push([
      order.reference,
      labelForStatus(order.status),
      order.pickupLabel,
      order.dropoffLabel,
      order.courier,
      String(order.amount)
    ]);
  }

  const csv = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `naaval-orders-${toPlanDate()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Orders exported as CSV.");
}

function downloadCsvTemplate() {
  const link = document.createElement("a");
  link.href = "./assets/order-import-template.csv";
  link.download = "naaval-vrp-simple-template.csv";
  link.click();
}

function handleDocumentClick(event) {
  const openModalButton = event.target.closest("[data-open-modal]");
  if (openModalButton) {
    const modalName = openModalButton.getAttribute("data-open-modal");
    if (modalName === "customer") {
      openCustomerModal();
    } else if (modalName === "driver") {
      openDriverModal();
    } else {
      openModal(modalName);
      syncFormDefaults();
    }
    return;
  }

  const closeModalButton = event.target.closest("[data-close-modal]");
  if (closeModalButton) {
    closeModal(closeModalButton.getAttribute("data-close-modal"));
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.activeView = viewButton.getAttribute("data-view");
    ensureSelections();
    render();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.getAttribute("data-action");

    if (action === "open-order-detail") {
      state.selectedOrderId = actionButton.getAttribute("data-order-id");
      render();
      openModal("order-detail");
      return;
    }

    if (action === "open-driver-detail") {
      state.selectedDriverId = actionButton.getAttribute("data-driver-id");
      render();
      openModal("driver-detail");
      return;
    }

    if (action === "open-customer-detail") {
      state.selectedCustomerId = actionButton.getAttribute("data-customer-id");
      render();
      openModal("customer-detail");
      return;
    }

    if (action === "edit-driver") {
      state.selectedDriverId = actionButton.getAttribute("data-driver-id");
      openDriverModal(state.selectedDriverId);
      return;
    }

    if (action === "open-create-driver") {
      openDriverModal();
      return;
    }

    if (action === "edit-customer") {
      state.selectedCustomerId = actionButton.getAttribute("data-customer-id");
      openCustomerModal(state.selectedCustomerId);
      return;
    }

    if (action === "open-ops-user-detail") {
      state.selectedOpsUserId = actionButton.getAttribute("data-ops-user-id");
      render();
      openModal("ops-user-detail");
      return;
    }

    if (action === "edit-ops-user") {
      state.editingOpsUserId = actionButton.getAttribute("data-ops-user-id");
      state.selectedOpsUserId = state.editingOpsUserId;
      state.adminSection = "users";
      closeModal("ops-user-detail");
      render();
      return;
    }

    if (action === "open-recurring-route-detail") {
      state.selectedRecurringRouteId = actionButton.getAttribute("data-recurring-route-id");
      render();
      openModal("recurring-route-detail");
      return;
    }

    if (action === "open-admin-pricing-algo") {
      state.selectedAdminPricingAlgo = actionButton.getAttribute("data-algo-id");
      render();
      openModal("admin-pricing");
      return;
    }

    if (action === "open-optimizer-time") {
      state.optimizerTimeField = actionButton.getAttribute("data-time-field");
      openModal("optimizer-time");
      return;
    }

    if (action === "set-pricing-algo-view") {
      state.selectedPricingAlgo = actionButton.getAttribute("data-algo-id");
      render();
      return;
    }

    if (action === "add-drop") {
      addDropoffSection();
      return;
    }

    if (action === "add-recurring-drop") {
      addDropoffSection("#recurring-dropoff-list", "remove-recurring-drop");
      return;
    }

    if (action === "remove-drop") {
      removeDropoffSection(Number.parseInt(actionButton.getAttribute("data-drop-index"), 10));
      return;
    }

    if (action === "remove-recurring-drop") {
      removeDropoffSection(Number.parseInt(actionButton.getAttribute("data-drop-index"), 10), "#recurring-dropoff-list", "remove-recurring-drop");
      return;
    }

    if (action === "toggle-recurring-day") {
      const form = document.querySelector("#recurring-route-form");
      if (!form) {
        return;
      }

      const day = actionButton.getAttribute("data-day");
      const current = new Set(
        String(form.elements.recurringDays.value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      );

      if (current.has(day)) {
        current.delete(day);
      } else {
        current.add(day);
      }

      const orderedDays = RECURRING_DAY_OPTIONS.map((option) => option.code).filter((code) => current.has(code));
      form.elements.recurringDays.value = orderedDays.join(",");
      updateRecurringDayUi(form);
      return;
    }

    if (action === "refresh") {
      refreshData(true);
      return;
    }

    if (action === "open-customer-portal") {
      window.open("/portal/", "_blank", "noopener,noreferrer");
      return;
    }

    if (action === "open-create-customer") {
      openCustomerModal();
      return;
    }

    if (action === "logout") {
      logout();
      showToast("Session closed.");
      return;
    }

    if (action === "seed-demo") {
      seedDemoData();
      return;
    }

    if (action === "select-visible-orders") {
      selectAllVisibleOrdersForPlanning();
      render();
      return;
    }

    if (action === "clear-visible-order-selection") {
      clearVisiblePlanningSelection();
      render();
      return;
    }

    if (action === "open-selected-orders-in-optimizer") {
      const selectedEligibleOrders = getSelectedPlanningOrders().filter((order) => canOrderBePlanned(order));
      if (selectedEligibleOrders.length === 0) {
        showToast("Select at least one eligible order first.", "error");
        return;
      }
      state.activeView = "optimizer";
      state.activeOptimizerStage = "setup";
      render();
      showToast(`${selectedEligibleOrders.length} order(s) ready for VRP optimization.`);
      return;
    }

    if (action === "run-planning") {
      runPlanning();
      return;
    }

    if (action === "set-optimizer-stage") {
      state.activeOptimizerStage = actionButton.getAttribute("data-optimizer-stage") || "setup";
      render();
      return;
    }

    if (action === "open-optimizer-builder") {
      state.activeOptimizerStage = "setup";
      render();
      return;
    }

    if (action === "select-planning-job") {
      state.selectedPlanningJobId = actionButton.getAttribute("data-plan-id");
      render();
      return;
    }

    if (action === "toggle-compare-plan") {
      const planId = actionButton.getAttribute("data-plan-id");
      const current = state.selectedComparePlanIds.filter(Boolean);
      if (current.includes(planId)) {
        state.selectedComparePlanIds = current.filter((candidate) => candidate !== planId);
      } else {
        state.selectedComparePlanIds = [...current, planId].slice(-2);
      }
      render();
      return;
    }

    if (action === "open-plan-routes" || action === "open-plan-route") {
      const planId = actionButton.getAttribute("data-plan-id");
      const routeId = actionButton.getAttribute("data-route-id");
      const plan = state.planningJobs.find((candidate) => candidate.id === planId);
      state.selectedPlanningJobId = planId;
      if (plan?.planDate) {
        state.selectedDate = plan.planDate;
      }
      state.selectedOptimizerRouteId = routeId || plan?.routeIds?.[0] || state.selectedOptimizerRouteId;
      state.activeOptimizerStage = "routes";
      render();
      return;
    }

    if (action === "validate-optimizer-data") {
      const visibleOrders = getVisibleOrders();
      if (visibleOrders.length === 0) {
        showToast("No imported data to validate yet.", "error");
        return;
      }

      state.activeOptimizerStage = "map";
      render();
      return;
    }

    if (action === "select-optimizer-route") {
      state.selectedOptimizerRouteId = actionButton.getAttribute("data-route-id");
      state.activeOptimizerStage = actionButton.getAttribute("data-target-stage") || "map";
      render();
      return;
    }

    if (action === "dispatch-route") {
      dispatchRoute(actionButton.getAttribute("data-route-id"));
      return;
    }

    if (action === "export-optimizer-route") {
      const selectedRoute = getOptimizerSelectedRoute(getVisibleRoutes());
      const selectedRouteContext = buildOptimizerRouteContext(selectedRoute);
      exportOptimizerRoute(selectedRoute, selectedRouteContext.routeOrders);
      return;
    }

    if (action === "export-orders") {
      exportOrders();
      return;
    }

    if (action === "reset-pricing-config") {
      resetPricingConfig();
      return;
    }

    if (action === "set-admin-section") {
      state.adminSection = actionButton.getAttribute("data-admin-section");
      render();
      return;
    }

    if (action === "cancel-edit-ops-user") {
      state.editingOpsUserId = null;
      render();
      return;
    }

    if (action === "open-quote") {
      state.quoteContext = getQuoteContextForSource(actionButton.getAttribute("data-quote-source"));
      document.querySelector("#quote-form")?.reset();
      syncQuoteForm();
      openModal("quote");
      return;
    }

    if (action === "open-quote-email") {
      state.quoteContext = getQuoteContextForSource(actionButton.getAttribute("data-quote-source"));
      document.querySelector("#quote-email-form")?.reset();
      openModal("quote-email");
      return;
    }

    if (action === "delete-ops-user") {
      deleteOpsUser(actionButton.getAttribute("data-ops-user-id"));
      return;
    }

    if (action === "delete-recurring-route") {
      deleteRecurringRoute(actionButton.getAttribute("data-recurring-route-id"));
      return;
    }

    if (action === "save-customer-pricing-algo") {
      const algoSelect = document.querySelector("#customer-pricing-algo-select");
      updateCustomerPricingAlgorithm(actionButton.getAttribute("data-customer-id"), algoSelect?.value || "basic");
      return;
    }

    if (action === "set-inbox-audience") {
      state.selectedInboxAudience = actionButton.getAttribute("data-inbox-audience");
      state.selectedInboxThreadId = getInboxThreads(state.selectedInboxAudience)[0]?.id ?? null;
      render();
      return;
    }

    if (action === "open-inbox-thread") {
      state.selectedInboxThreadId = actionButton.getAttribute("data-thread-id");
      render();
      return;
    }

    if (action === "set-pricing-basic-size") {
      setPricingSelection("basic.size", actionButton.getAttribute("data-size"));
      render();
      return;
    }

    if (action === "set-optimizer-setup-size") {
      state.optimizerSetup.parcelSize = actionButton.getAttribute("data-size") || "S";
      render();
      return;
    }

    if (action === "set-pricing-hours-vehicle") {
      setPricingSelection("hours.vehicle", actionButton.getAttribute("data-vehicle-type"));
      render();
      return;
    }

    if (action === "set-pricing-drops-vehicle") {
      setPricingSelection("drops.vehicle", actionButton.getAttribute("data-vehicle-type"));
      render();
      return;
    }

    if (action === "import-csv") {
      document.querySelector("#csv-import-input").click();
      return;
    }

    if (action === "download-csv-template") {
      downloadCsvTemplate();
    }
  }
}

function handleDocumentInput(event) {
  const pricingInput = event.target.closest("[data-pricing-draft]");
  if (!pricingInput) {
    return;
  }

  updatePricingDraft(pricingInput.getAttribute("data-pricing-draft"), pricingInput.value);
}

function handleDocumentChange(event) {
  if (event.target.matches("#selected-date")) {
    state.selectedDate = event.target.value || toDateKey();
    ensureSelections();
    render();
    return;
  }

  const planningSelectionCheckbox = event.target.closest("[data-planning-order-checkbox]");
  if (planningSelectionCheckbox) {
    togglePlanningOrderSelection(
      planningSelectionCheckbox.getAttribute("data-planning-order-checkbox"),
      planningSelectionCheckbox.checked
    );
    render();
    return;
  }

  if (event.target.matches("[data-optimizer-formula]")) {
    state.optimizerSetup.formula = event.target.value || "completion_time";
    render();
    return;
  }

  const optimizerSetupInput = event.target.closest("[data-optimizer-setup]");
  if (optimizerSetupInput) {
    updateOptimizerSetupField(optimizerSetupInput.getAttribute("data-optimizer-setup"), optimizerSetupInput.value);
    render();
    return;
  }

  const optimizerHeaderInput = event.target.closest("[data-optimizer-header]");
  if (optimizerHeaderInput) {
    const columnId = optimizerHeaderInput.getAttribute("data-optimizer-header");
    state.optimizerSpreadsheetHeaders[columnId] = optimizerHeaderInput.value.trim() || buildDefaultOptimizerSpreadsheetHeaders()[columnId] || columnId;
    render();
    return;
  }

  const optimizerCellInput = event.target.closest("[data-optimizer-cell]");
  if (optimizerCellInput) {
    void updateOptimizerSpreadsheetCell(
      optimizerCellInput.getAttribute("data-order-id"),
      optimizerCellInput.getAttribute("data-optimizer-cell"),
      optimizerCellInput.value
    );
    return;
  }

  const pricingInput = event.target.closest("[data-pricing-draft]");
  if (pricingInput) {
    updatePricingDraft(pricingInput.getAttribute("data-pricing-draft"), pricingInput.value);
    render();
    return;
  }

  const assignmentSelect = event.target.closest("[data-order-assignment]");
  if (assignmentSelect) {
    assignDriverToOrder(assignmentSelect.getAttribute("data-order-assignment"), assignmentSelect.value);
    return;
  }

  const carrierCompanySelect = event.target.closest("[data-order-carrier-company]");
  if (carrierCompanySelect) {
    const orderId = carrierCompanySelect.getAttribute("data-order-carrier-company");
    state.orderAssignmentFilters[orderId] = carrierCompanySelect.value;
    render();
  }
}

function handleDocumentSubmit(event) {
  if (event.defaultPrevented) {
    return;
  }

  if (event.target.matches("#inbox-reply-form")) {
    handleInboxReplySubmit(event);
    return;
  }

  if (event.target.matches("#optimizer-time-form")) {
    handleOptimizerTimeSubmit(event);
    return;
  }

  if (event.target.matches("#pricing-admin-form")) {
    handlePricingAdminSubmit(event);
    return;
  }

  if (event.target.matches("#pricing-algo-form")) {
    handlePricingAlgoSubmit(event);
    return;
  }

  if (event.target.matches("#ops-user-form")) {
    handleOpsUserSubmit(event);
    return;
  }

  if (event.target.matches("#customer-form")) {
    handleCustomerSubmit(event);
    return;
  }

  if (event.target.matches("#recurring-route-form")) {
    handleRecurringRouteSubmit(event);
    return;
  }
}

function handleLoginSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const email = form.elements.email.value.trim().toLowerCase();
  const password = form.elements.password.value.trim();
  const matchingUser =
    state.opsUsers.find((user) => String(user.email ?? "").trim().toLowerCase() === email) ??
    (email === "pierre@naaval.app"
      ? {
          id: "ops_demo_pierre",
          firstName: "Pierre",
          lastName: "Ops",
          email,
          temporaryPassword: "demo"
        }
      : null);
  const expectedPassword = String(matchingUser?.temporaryPassword ?? "demo").trim() || "demo";

  if (!matchingUser || password !== expectedPassword) {
    showToast("Use a valid ops email and the matching temporary password.", "error");
    return;
  }

  loginWithProfile(matchingUser, "password");
  showToast(`Welcome back ${matchingUser.firstName ?? "Ops"}.`);
}

function handleGoogleLogin() {
  loginWithProfile(
    {
      id: "ops_google_demo",
      firstName: "Pierre",
      lastName: "Google",
      email: "pierre@naaval.app"
    },
    "google-demo"
  );
  showToast("Google login simulated in prototype mode.");
}

function bindEvents() {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("submit", handleDocumentSubmit);
  document.querySelector("#login-form").addEventListener("submit", handleLoginSubmit);
  document.querySelector("#google-login-button").addEventListener("click", handleGoogleLogin);
  document.querySelector("#order-form").addEventListener("submit", handleOrderSubmit);
  document.querySelector("#driver-form").addEventListener("submit", handleDriverSubmit);
  document.querySelector("#carrier-company-form").addEventListener("submit", handleCarrierCompanySubmit);
  document.querySelector("#customer-form").addEventListener("submit", handleCustomerSubmit);
  document.querySelector("#quote-form").addEventListener("submit", handleQuoteSubmit);
  document.querySelector("#quote-email-form").addEventListener("submit", handleQuoteEmailSubmit);
  document.querySelector("#csv-import-input").addEventListener("change", handleCsvImport);
}

async function initialize() {
  bindEvents();
  syncOpsLiveRefreshLoop();
  const session = restoreSession();
  if (session?.email) {
    state.isAuthenticated = true;
    state.currentUser = session;
  }
  updateAuthUi();
  await refreshData();
  setupGoogleIdentity();
}

initialize();
