import database from '../../models/index.js';

const {TestMigration} = database;

const TestMigrationController = {
  async create(testMigration) {
    try {
      const newTestMigrationTransaction = await database.sequelize.transaction(async (t) => {
        const newTestMigration = await TestMigration.create(testMigration, {transaction: t});
        return newTestMigration;
      });
      return newTestMigrationTransaction.id;
    } catch {
      return undefined;
    }
  },

  async findOne(id) {
    return TestMigration.findByPk(id);
  },

  async findAll() {
    return TestMigration.findAll();
  }
};

export {TestMigrationController as default};
