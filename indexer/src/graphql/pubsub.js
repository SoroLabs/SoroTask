const { PubSub } = require('graphql-subscriptions');

/**
 * Process-local pub/sub for GraphQL subscriptions (Issue #824). Published to
 * from the same ingestion call site that already feeds the bespoke `/ws`
 * stream (see index.js), so both transports observe the same events.
 */
const pubsub = new PubSub();

const EVENT_ADDED = 'EVENT_ADDED';

module.exports = { pubsub, EVENT_ADDED };
