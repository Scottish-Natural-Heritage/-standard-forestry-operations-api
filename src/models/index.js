import Sequelize from 'sequelize';
import databaseConfig from '../config/database.js';
import Application from './application.js';
import Sett from './sett.js';
import ApplyOther from './apply-other.js';
import Revocation from './revocation.js';
import Note from './note.js';
import Returns from './returns.js';
import OldReturns from './old-returns.js';
import SettPhotos from './sett-photos.js';
import TestMigration from './test-migration.js';

const sequelize = new Sequelize(databaseConfig.database);

const database = {
  sequelize,
  Application: Application(sequelize),
  Sett: Sett(sequelize),
  Note: Note(sequelize),
  ApplyOther: ApplyOther(sequelize),
  Revocation: Revocation(sequelize),
  Returns: Returns(sequelize),
  OldReturns: OldReturns(sequelize),
  SettPhotos: SettPhotos(sequelize),
  TestMigration: TestMigration(sequelize)
};

database.Application.hasMany(database.Sett);
database.Application.hasMany(database.Note);
database.Application.hasOne(database.Revocation);
database.Application.hasMany(database.OldReturns);
database.OldReturns.belongsTo(database.Application);
database.Application.hasMany(database.Returns);
database.Returns.belongsTo(database.Application);
database.Note.belongsTo(database.Application);
database.Sett.belongsTo(database.Application);
database.Revocation.belongsTo(database.Application);
database.SettPhotos.belongsTo(database.Returns);
database.Returns.hasMany(database.SettPhotos);
database.SettPhotos.belongsTo(database.Sett);
database.Sett.hasOne(database.SettPhotos);

export {database as default};
