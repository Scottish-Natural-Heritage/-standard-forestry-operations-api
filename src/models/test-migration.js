'use strict';

import Sequelize from 'sequelize';

const {Model} = Sequelize;

/**
 * Build a TestMigration model.
 *
 * @param {Sequelize.Sequelize} sequelize A Sequelize connection.
 * @returns {Sequelize.Model} An TestMigration model.
 */
const TestMigrationModel = (sequelize) => {
  class TestMigration extends Model {}

  TestMigration.init(
    {
      testColumn: {
        type: Sequelize.TEXT
      }
    },
    {
      sequelize,
      modelName: 'TestMigration',
      timestamps: true,
      paranoid: true
    }
  );

  return TestMigration;
};

export {TestMigrationModel as default};
