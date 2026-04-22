const { ROLES } = require("../constants/roles");
const { hasRole } = require("./user-roles");

const isWorkerPayoutReady = (user) =>
  Boolean(
    user &&
      hasRole(user, ROLES.WORKER) &&
      user.workerStatus === "approved" &&
      user.stripeConnectedAccountId &&
      user.stripeConnectDetailsSubmitted &&
      user.stripeConnectPayoutsEnabled
  );

const getWorkerPayoutReadiness = (user) => ({
  hasConnectedAccount: Boolean(user?.stripeConnectedAccountId),
  detailsSubmitted: Boolean(user?.stripeConnectDetailsSubmitted),
  payoutsEnabled: Boolean(user?.stripeConnectPayoutsEnabled),
  chargesEnabled: Boolean(user?.stripeConnectChargesEnabled),
  isReady: isWorkerPayoutReady(user),
});

module.exports = {
  isWorkerPayoutReady,
  getWorkerPayoutReadiness,
};
