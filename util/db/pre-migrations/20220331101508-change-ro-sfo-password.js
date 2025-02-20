'use strict';
const process = require('process');
const config = require('../../../src/config/database.js').ssDatabase;

if (process.env.NODE_ENV === 'production') {
  module.exports = {
    async up(queryInterface, Sequelize) {
      await queryInterface.sequelize.query('ALTER ROLE rosfo WITH PASSWORD :roSfoPassword;', {
        type: Sequelize.QueryTypes.RAW,
        replacements: {
          roSfoPassword: config.password
        }
      });

      await queryInterface.sequelize.query('revoke sfo from licensing;', {
        type: Sequelize.QueryTypes.RAW
      });
    },

    async down(queryInterface, Sequelize) {
      await queryInterface.sequelize.query('grant sfo to licensing;', {
        type: Sequelize.QueryTypes.RAW
      });

      await queryInterface.sequelize.query("ALTER ROLE rosfo WITH PASSWORD 'override_this_value';", {
        type: Sequelize.QueryTypes.RAW
      });
    }
  };
} else {
  module.exports = {
    up() {
      return Promise.resolve();
    },
    down() {
      return Promise.resolve();
    }
  };
}
