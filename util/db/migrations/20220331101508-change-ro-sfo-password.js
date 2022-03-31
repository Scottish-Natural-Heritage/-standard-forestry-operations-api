'use strict';

const config = require('../../../src/config/database.js').ssDatabase;

if (process.env.NODE_ENV === 'production') {
  module.exports = {
    up: async (queryInterface, Sequelize) => {
      return queryInterface.sequelize.query('ALTER ROLE rosfo WITH PASSWORD :roSfoPassword;', {
        type: Sequelize.QueryTypes.RAW,
        replacements: {
          roSfoPassword: config.password
        }
      });
    },

    down: async (queryInterface, Sequelize) => {
      return queryInterface.sequelize.query("ALTER ROLE rosfo WITH PASSWORD 'override_this_value';", {
        type: Sequelize.QueryTypes.RAW
      });
    }
  };
} else {
  module.exports = {
    up: () => {
      return Promise.resolve();
    },
    down: () => {
      return Promise.resolve();
    }
  };
}
