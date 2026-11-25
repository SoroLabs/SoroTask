const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Generate some realistic-looking tasks with recent dates
const now = Date.now();
const oneHour = 60 * 60 * 1000;
const oneDay = 24 * oneHour;

const tasks = [
  {
    task_id: "1",
    target: "CCQWXV6V77J3Z3B3C7P5FJG7UXYPXYM3H5Q",
    function: "harvest_yield",
    interval: 86400, // Daily
    gas_balance: "500.0000000",
    is_active: 1,
    updated_at: new Date(now - oneHour * 2).toISOString()
  },
  {
    task_id: "2",
    target: "CDX1234V77J3Z3B3C7P5FJG7UXYPXYM3H5Q",
    function: "rebalance_portfolio",
    interval: 604800, // Weekly
    gas_balance: "150.5000000",
    is_active: 1,
    updated_at: new Date(now - oneDay * 3).toISOString()
  },
  {
    task_id: "3",
    target: "CABC123V77J3Z3B3C7P5FJG7UXYPXYM3H5Q",
    function: "distribute_rewards",
    interval: 3600, // Hourly
    gas_balance: "10.0000000",
    is_active: 1,
    updated_at: new Date(now - 15 * 60 * 1000).toISOString() // 15 mins ago
  },
  {
    task_id: "4",
    target: "CDEF456V77J3Z3B3C7P5FJG7UXYPXYM3H5Q",
    function: "liquidate_positions",
    interval: 300, // 5 minutes
    gas_balance: "2500.0000000",
    is_active: 1,
    updated_at: new Date(now - 2 * 60 * 1000).toISOString() // 2 mins ago
  },
  {
    task_id: "5",
    target: "CXYZ789V77J3Z3B3C7P5FJG7UXYPXYM3H5Q",
    function: "update_oracle_price",
    interval: 60, // 1 minute
    gas_balance: "0.0000000", // Out of gas
    is_active: 0, // Paused
    updated_at: new Date(now - oneDay * 5).toISOString()
  }
];

app.post('/graphql', (req, res) => {
  const { query, variables } = req.body;
  
  if (query.includes('GetTasks')) {
    return res.json({ data: { tasks } });
  } else if (query.includes('GetTask')) {
    const task = tasks.find(t => t.task_id === variables.id) || tasks[0];
    return res.json({ data: { task } });
  } else if (query.includes('PauseTask')) {
    const taskIndex = tasks.findIndex(t => t.task_id === variables.id);
    if (taskIndex !== -1) {
      tasks[taskIndex].is_active = 0;
      tasks[taskIndex].updated_at = new Date().toISOString();
    }
    return res.json({ data: { pauseTask: { task_id: variables.id } } });
  }
  
  return res.json({ data: null });
});

app.listen(4000, () => {
  console.log('Mock GraphQL server listening on port 4000 with realistic data');
});
