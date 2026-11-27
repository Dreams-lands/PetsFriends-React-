const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { mysql, poolPromise } = require('../../../api/db');

module.exports = { mysql, poolPromise };
