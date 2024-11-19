import process from 'process';
import express from 'express';
import jwt from 'jsonwebtoken';
import ApplicationController, {cleanPatchInput} from './controllers/v2/application.js';
import Sett from './controllers/v2/sett.js';
import {ReturnsController} from './controllers/v2/returns.js';
import Note from './controllers/v2/note.js';
import ScheduledController from './controllers/v2/scheduled.js';
import jsonConsoleLogger, {unErrorJson} from './json-console-logger.js';
import config from './config/app.js';
import {EmailService} from './services/email-service.js';
import jwk from './config/jwk.js';

const v2router = express.Router();

v2router.get('/health', async (request, response) => {
  response.status(200).send({message: 'OK'});
});

/**
 * READs all applications.
 */
v2router.get('/applications', async (request, response) => {
  try {
    const applications = await ApplicationController.findAll();

    if (applications === undefined || applications === null) {
      return response.status(404).send({message: `No applications found.`});
    }

    return response.status(200).send(applications);
  } catch (error) {
    jsonConsoleLogger.error(unErrorJson(error));
    return response.status(500).send({error});
  }
});

/**
 * READs a single application.
 */
v2router.get('/applications/:id', async (request, response) => {
  try {
    const existingId = Number(request.params.id);
    if (Number.isNaN(existingId)) {
      return response.status(404).send({message: `Application ${request.params.id} not valid.`});
    }

    const application = await ApplicationController.findOne(existingId);

    if (application === undefined || application === null) {
      return response.status(404).send({message: `Application ${request.params.id} not valid.`});
    }

    return response.status(200).send(application);
  } catch (error) {
    jsonConsoleLogger.error(unErrorJson(error));
    return response.status(500).send({error});
  }
});

/**
 * Calculates the licence expiry date.
 *
 * @returns {Date} the calculated expiry date.
 */
const calculateExpiryDate = () => {
  const currentYear = new Date().getFullYear();

  const expiryDate = new Date().getMonth() + 1 < 12 ? new Date(currentYear, 10, 30) : new Date(currentYear + 1, 10, 30);

  return expiryDate;
};

/**
 * Validate the incoming POST request body to make sure it is compatible with the
 * database and data model.
 *
 * @param {any} body The incoming request's body.
 * @returns {any} A json object that's just got our cleaned up fields on it.
 */
const cleanAppInput = (body) => {
  // Ensure required fields are present and of the expected type.
  if (
    [
      typeof body.convictions !== Boolean.name.toLowerCase(),
      typeof body.complyWithTerms !== Boolean.name.toLowerCase(),
      typeof body.fullName !== String.name.toLowerCase(),
      body.fullName === '',
      typeof body.addressLine1 !== String.name.toLowerCase(),
      body.addressLine1 === '',
      typeof body.addressTown !== String.name.toLowerCase(),
      body.addressTown === '',
      typeof body.addressPostcode !== String.name.toLowerCase(),
      body.addressPostcode === '',
      typeof body.phoneNumber !== String.name.toLowerCase(),
      body.phoneNumber === '',
      typeof body.emailAddress !== String.name.toLowerCase(),
      body.emailAddress === '',
      !Array.isArray(body.setts)
    ].some(Boolean)
  ) {
    throw new Error('Invalid data');
  }

  for (const sett of body.setts) {
    if (
      [
        typeof sett.id !== String.name.toLowerCase(),
        sett.id === '',
        typeof sett.gridReference !== String.name.toLowerCase(),
        sett.gridReference === '',
        typeof sett.entrances !== Number.name.toLowerCase()
      ].some(Boolean)
    ) {
      throw new Error('Invalid data');
    }
  }

  // Ensure optional fields are of the expected type if present.
  if (
    [
      body.companyOrganisation && typeof body.companyOrganisation !== String.name.toLowerCase(),
      body.addressLine2 && typeof body.addressLine2 !== String.name.toLowerCase(),
      body.addressCounty && typeof body.addressCounty !== String.name.toLowerCase(),
      body.createdByLicensingOfficer && typeof body.createdByLicensingOfficer !== String.name.toLowerCase(),
      body.uprn && typeof body.uprn !== String.name.toLowerCase()
    ].some(Boolean)
  ) {
    throw new Error('Invalid data');
  }

  for (const sett of body.setts) {
    if (sett.createdByLicensingOfficer && typeof sett.createdByLicensingOfficer !== String.name.toLowerCase()) {
      throw new Error('Invalid data');
    }
  }

  return {
    // The booleans are just copied across.
    convictions: body.convictions,
    complyWithTerms: body.complyWithTerms,

    // Required string fields are trimmed
    // and optional string fields are trimmed if present
    // or set to undefined if missing.
    fullName: body.fullName.trim(),
    companyOrganisation: body.companyOrganisation ? body.companyOrganisation.trim() : undefined,
    addressLine1: body.addressLine1.trim(),
    addressLine2: body.addressLine2 ? body.addressLine2.trim() : undefined,
    addressTown: body.addressTown.trim(),
    addressCounty: body.addressCounty.trim(),
    addressPostcode: body.addressPostcode.trim(),
    phoneNumber: body.phoneNumber.trim(),
    emailAddress: body.emailAddress.trim(),
    createdByLicensingOfficer: body.createdByLicensingOfficer ? body.createdByLicensingOfficer.trim() : undefined,
    expiryDate: calculateExpiryDate(),
    uprn: body.uprn ? body.uprn.trim() : undefined,

    // Trim the string fields for each sett.
    setts: body.setts.map((sett) => {
      return {
        // The number is just copied across.
        entrances: sett.entrances,

        // The three strings are trimmed then copied.
        id: sett.id === sett.id.trim(),
        gridReference: sett.gridReference === sett.gridReference.trim(),
        createdByLicensingOfficer: sett.createdByLicensingOfficer ? sett.createdByLicensingOfficer.trim() : undefined
      };
    })
  };
};

/**
 * Creates a new application.
 */
v2router.post('/applications', async (request, response) => {
  let sfoApplication;
  try {
    // Clean up the user's input before we store it in the database.
    sfoApplication = cleanAppInput(request.body);
  } catch {
    return response.status(400).send({message: `Could not create application. Invalid data submitted`});
  }

  try {
    // Create a new id wrapped in a database transaction
    const newId = await ApplicationController.create(sfoApplication);

    // If we were not able to create the new application then we need to respond with a 500 error.
    if (newId === undefined) {
      return response.status(500).send({message: `Could not create application.`});
    }

    // Create baseUrl.
    const baseUrl = new URL(
      `${request.protocol}://${request.hostname}:${config.port}${request.originalUrl}${
        request.originalUrl.endsWith('/') ? '' : '/'
      }`
    );

    // Return the new location of the newly created application.
    return response.status(201).location(new URL(newId, baseUrl)).send();
  } catch (error) {
    return response.status(500).send({message: `Could not create application. in final catch ${error.message}`});
  }
});

/**
 * Clean the incoming POST request body to make it more compatible with the
 * database and its validation rules.
 *
 * @param {any} existingId The ID of the license that the sett belongs to.
 * @param {any} body The incoming request's body.
 * @returns {any} A json object that's just got our cleaned up fields on it.
 */
const cleanSettInput = (existingId, body) => {
  return {
    ApplicationId: existingId,
    // The strings are trimmed for leading and trailing whitespace and then
    // copied across if they're in the POST body or are set to undefined if
    // they're missing.
    sett: body.sett === undefined ? undefined : body.sett.trim(),
    gridRef: body.gridReference === undefined ? undefined : body.gridReference.trim(),
    entrances: body.entrances === undefined ? undefined : body.entrances,
    createdByLicensingOfficer: body.createdByLicensingOfficer
  };
};

// Allow the API consumer to submit a sett against a application.
v2router.post('/applications/:id/setts', async (request, response) => {
  try {
    // Try to parse the incoming ID to make sure it's really a number.
    const existingId = Number(request.params.id);
    if (Number.isNaN(existingId)) {
      return response.status(404).send({message: `Application ${request.params.id} not valid.`});
    }

    // Clean up the user's input before we store it in the database.
    const cleanObject = cleanSettInput(existingId, request.body);

    // Create a new id wrapped in a database transaction
    const newId = await Sett.create(existingId, cleanObject);

    if (newId === undefined) {
      return response.status(500).send({message: `Could not create sett for license ${existingId}.`});
    }

    const baseUrl = new URL(
      `${request.protocol}://${request.hostname}:${config.port}${request.originalUrl}${
        request.originalUrl.endsWith('/') ? '' : '/'
      }`
    );

    return response.status(201).location(new URL(newId, baseUrl)).send();
  } catch (error) {
    return response.status(500).send({error});
  }
});

/**
 * Clean the incoming POST request body to make it more compatible with the
 * database and its validation rules.
 *
 * @param {any} existingId The ID of the license that the note belongs to.
 * @param {any} body The incoming request's body.
 * @returns {any} A json object that's just got our cleaned up fields on it.
 */
const cleanNoteInput = (existingId, body) => {
  return {
    ApplicationId: existingId,
    // The strings are trimmed for leading and trailing whitespace and then
    // copied across if they're in the POST body or are set to undefined if
    // they're missing.
    note: body.note.trim(),
    createdBy: body.createdBy
  };
};

// Allow the API consumer to submit a note against a application.
v2router.post('/applications/:id/notes', async (request, response) => {
  try {
    // Try to parse the incoming ID to make sure it's really a number.
    const existingId = Number(request.params.id);
    if (Number.isNaN(existingId)) {
      return response.status(404).send({message: `Application ${request.params.id} not valid.`});
    }

    // Check if there's a application allocated at the specified ID.
    const existingApplication = await ApplicationController.findOne(existingId);
    if (existingApplication === undefined || existingApplication === null) {
      return response.status(404).send({message: `application ${existingId} not allocated.`});
    }

    // Clean up the user's input before we store it in the database.
    const cleanObject = cleanNoteInput(existingId, request.body);

    // Create a new id wrapped in a database transaction
    const newNote = await Note.create(existingId, cleanObject);

    if (newNote === undefined) {
      return response.status(500).send({message: `Could not create note for licence ${existingId}.`});
    }

    const baseUrl = new URL(
      `${request.protocol}://${request.hostname}:${config.port}${request.originalUrl}${
        request.originalUrl.endsWith('/') ? '' : '/'
      }`
    );

    return response.status(201).location(new URL(newNote, baseUrl)).send();
  } catch (error) {
    return response.status(500).send({error});
  }
});

/**
 * Clean the incoming POST request body to make it more compatible with the
 * database and its validation rules.
 *
 * @param {any} existingId The return that is being created.
 * @param {any} body The incoming request's body.
 * @returns {any} A json object that's just got our cleaned up fields on it.
 */
const cleanReturnInput = (existingId, body) => {
  return {
    ApplicationId: existingId,
    // The strings are trimmed for leading and trailing whitespace and then
    // copied across if they're in the POST body or are set to undefined if
    // they're missing.
    usedLicence: body.didYouUse,
    startDate: body.startDate === undefined ? undefined : body.startDate,
    endDate: body.endDate === undefined ? undefined : body.endDate,
    compliance: body.compliance,
    complianceDetails: body.complianceDetails === undefined ? undefined : body.complianceDetails.trim(),
    confirmedDeclaration: body.confirmDeclaration,
    createdByLicensingOfficer:
      body.createdByLicensingOfficer === undefined ? undefined : body.createdByLicensingOfficer.trim()
  };
};

/**
 * Creates a new application return.
 */
v2router.post('/applications/:id/returns', async (request, response) => {
  try {
    // Try to parse the incoming ID to make sure it's really a number.
    const licenceApplicationId = Number(request.params.id);
    if (Number.isNaN(licenceApplicationId)) {
      return response.status(404).send({message: `Application ${request.params.id} not valid.`});
    }

    // Clean up the user's input before we store it in the database.
    const submittedReturn = cleanReturnInput(licenceApplicationId, request.body);

    // We also need some application details for the return email so grab the application.
    const application = await ApplicationController.findOne(submittedReturn.ApplicationId);

    // Write the Return data to the database.
    let newReturnId;
    if (submittedReturn.usedLicence) {
      // If the user used the licence, get the sett and photos data from the request.
      const {settIds, settNames, uploadedFileData} = request.body;

      // Insert return and sett photos data into database and return the ID of the new return.
      try {
        newReturnId = await ReturnsController.create(submittedReturn, settIds, uploadedFileData);
      } catch (error) {
        // Log error and bail out.
        jsonConsoleLogger.error(error);
        return response.status(500).send({message: `Could not create return for license ${licenceApplicationId}.`});
      }

      // Send out the success email.
      try {
        await EmailService.sendReturnEmailUsedLicence(
          application,
          submittedReturn,
          settNames,
          uploadedFileData,
          application.emailAddress
        );
        await EmailService.sendReturnEmailUsedLicence(
          application,
          submittedReturn,
          settNames,
          uploadedFileData,
          'issuedlicence@nature.scot'
        );
      } catch (error) {
        // Log email error and carry on.
        jsonConsoleLogger.error(error);
      }
    } else {
      // If the user did not use the licence we still need to save their more-or-less empty return.
      try {
        newReturnId = await ReturnsController.createLicenceNotUsed(submittedReturn);
      } catch (error) {
        // Log error and bail out.
        jsonConsoleLogger.error(error);
        return response.status(500).send({message: `Could not create return for license ${licenceApplicationId}.`});
      }

      // Send out the success email.
      try {
        await EmailService.sendReturnEmailNotUsedLicence(application, application.emailAddress);
        await EmailService.sendReturnEmailNotUsedLicence(application, 'issuedlicence@nature.scot');
      } catch (error) {
        // Log email error and carry on.
        jsonConsoleLogger.error(error);
      }
    }

    // If we were unable to create the new return then we need to send back a suitable response.
    if (newReturnId === undefined) {
      return response.status(500).send({message: `Could not create return for license ${licenceApplicationId}.`});
    }

    // Create baseUrl.
    const baseUrl = new URL(
      `${request.protocol}://${request.hostname}:${config.port}${request.originalUrl}${
        request.originalUrl.endsWith('/') ? '' : '/'
      }`
    );

    // Return 201 created and add the location of the new return to the response headers.
    return response.status(201).location(new URL(newReturnId, baseUrl)).send();
  } catch (error) {
    return response.status(500).send({error});
  }
});

// Allow an API consumer to save a application against an allocated but un-assigned application number.
// No PUT endpoint is required as we now use a PATCH method of updating details.
v2router.put('/applications/:id', async (request, response) => {
  return response.status(501).send({message: 'Not implemented.'});
});

/**
 * Clean the incoming request body to make it more compatible with the
 * database and its validation rules.
 *
 * @param {any} existingId The application that is being revoked.
 * @param {any} body The incoming request's body.
 * @returns {any} A json object that's just got our cleaned up fields on it.
 */
const cleanRevokeInput = (existingId, body) => {
  return {
    ApplicationId: existingId,
    // The strings are trimmed for leading and trailing whitespace and then
    // copied across if they're in the POST body or are set to undefined if
    // they're missing.
    reason: body.reason === undefined ? undefined : body.reason.trim(),
    createdBy: body.createdBy === undefined ? undefined : body.createdBy.trim(),
    isRevoked: body.isRevoked
  };
};

/**
 * UPDATEs part of a single application.
 */
v2router.patch('/applications/:id', async (request, response) => {
  try {
    // Try to parse the incoming ID to make sure it's really a number.
    const existingId = Number(request.params.id);
    if (Number.isNaN(existingId)) {
      return response.status(404).send({message: `application ${request.params.id} not valid.`});
    }

    // Check if there's a application allocated at the specified ID.
    const existingApplication = await ApplicationController.findOne(existingId);
    if (existingApplication === undefined || existingApplication === null) {
      return response.status(404).send({message: `application ${existingId} not allocated.`});
    }

    // Clean up the user's input before we store it in the database.
    let cleanObject;
    try {
      cleanObject = cleanPatchInput(request.body);
    } catch (error) {
      return response.status(400).send({message: `Could not update application ${existingId}. ${error.message}`});
    }

    // Update the application in the database with our client's values.
    const updatedApplication = await ApplicationController.update(existingId, cleanObject);

    // If they're not successful, send a 500 error.
    if (updatedApplication === undefined) {
      return response.status(500).send({message: `Could not update application ${existingId}.`});
    }

    // If they are, send back the updated fields.
    return response.status(200).send(updatedApplication);
  } catch (error) {
    // When anything else goes wrong send the error to the client.
    return response.status(500).send({error});
  }
});

/**
 * DELETEs a single application and all child records.
 */
v2router.delete('/applications/:id', async (request, response) => {
  try {
    // Try to parse the incoming ID to make sure it's really a number.
    const existingId = Number(request.params.id);
    if (Number.isNaN(existingId)) {
      return response.status(404).send({message: `Application ${request.params.id} not valid.`});
    }

    // Clean up the user's input before we store it in the database.
    const cleanObject = cleanRevokeInput(existingId, request.body);
    // Attempt to delete the application and all child records.
    const deleteApplication = await ApplicationController.delete(existingId, cleanObject);

    // If we were unable to delete the application we need to return a 500 with a suitable error message.
    if (deleteApplication === false) {
      return response.status(500).send({message: `Could not delete Application ${existingId}.`});
    }

    // If we were able to delete the application we need to return a 200.
    return response.status(200).send();
  } catch (error) {
    // If anything goes wrong (such as a validation error), tell the client.
    return response.status(500).send({error});
  }
});

// Save an incoming email address so we can email them later once the apply on
// behalf of others service is up and running.
// this may need done in the future but currently we cant apply on behalf of.
v2router.post('/apply-other', async (request, response) => {
  return response.status(501).send({message: 'Not implemented.'});
});

/**
 * DELETEs a single Sett.
 */
v2router.delete('/applications/:id/setts/:settId', async (request, response) => {
  try {
    // Try to parse the incoming application ID to make sure it's really a number.
    const existingId = Number(request.params.id);
    if (Number.isNaN(existingId)) {
      return response.status(404).send({message: `Application ${request.params.id} not valid.`});
    }

    // Try to parse the incoming Sett ID to make sure it's really a number.
    const existingSettId = Number(request.params.settId);
    if (Number.isNaN(existingSettId)) {
      return response.status(404).send({message: `Sett ${request.params.settId} not valid.`});
    }

    // Attempt to delete the sett.
    const deleteSett = await Sett.delete(existingSettId);
    // If we were unable to delete the sett we need to return a 500 with a suitable error message.
    if (deleteSett === false) {
      return response.status(500).send({message: `Could not delete Sett ${existingSettId}.`});
    }

    // If we were able to delete the sett we need to return a 200.
    return response.status(200).send();
  } catch (error) {
    // If anything goes wrong (such as a validation error), tell the client.
    return response.status(500).send({error});
  }
});

/**
 * READs all setts.
 */
v2router.get('/setts', async (request, response) => {
  try {
    const setts = await Sett.findAll();

    if (setts === undefined || setts === null) {
      return response.status(404).send({message: `No setts found.`});
    }

    return response.status(200).send(setts);
  } catch (error) {
    jsonConsoleLogger.error(unErrorJson(error));
    return response.status(500).send({error});
  }
});

/**
 * Resend a licence.
 */
v2router.post('/applications/:id/resend', async (request, response) => {
  try {
    // Try to parse the incoming ID to make sure it's really a number.
    const existingId = Number(request.params.id);
    if (Number.isNaN(existingId)) {
      return response.status(404).send({message: `application ${request.params.id} not valid.`});
    }

    // Check if there's a application allocated at the specified ID.
    const existingApplication = await ApplicationController.findOne(existingId);
    if (existingApplication === undefined || existingApplication === null) {
      return response.status(404).send({message: `application ${existingId} not allocated.`});
    }

    // Call the application's resend function to resend the licence email.
    const result = await ApplicationController.resend(existingId, existingApplication);

    // Return success response.
    return response.status(200).send(result);
  } catch (error) {
    jsonConsoleLogger.error(unErrorJson(error));
    return response.status(500).send({error});
  }
});

/**
 * Send out a reminder email on licences that have expired with no returns submitted.
 */
v2router.post('/expired-no-return-reminder', async (request, response) => {
  // We need to know the date and year.
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();

  try {
    const applications = await ScheduledController.findAll();

    // Filter the applications so only those that have expired (expiryDate is previous year)
    // and have no returns (old or new) are left.
    const filteredApplications = applications.filter((application) => {
      return (
        new Date(application.expiryDate).getFullYear() === currentYear - 1 &&
        application.Returns.length === 0 &&
        application.OldReturns.length === 0
      );
    });

    // Try to send out reminder emails.
    const emailsSent = await ScheduledController.sendExpiredReturnReminder(filteredApplications);

    return response.status(200).send({message: `Sent ${emailsSent} expired licence with no return reminder emails.`});
  } catch (error) {
    jsonConsoleLogger.error(unErrorJson(error));
    return response.status(500).send({error});
  }
});

/**
 * Send out a reminder email on licences that are due to expire soon.
 */
v2router.post('/soon-to-expire-return-reminder', async (request, response) => {
  // We need to know the date.
  const currentDate = new Date();

  try {
    const applications = await ScheduledController.findAll();

    // Filter the applications so only those that have not yet expired are left.
    const filteredApplications = applications.filter((application) => {
      return application.expiryDate > currentDate;
    });

    // Try to send out reminder emails.
    const emailsSent = await ScheduledController.sendSoonExpiredReturnReminder(filteredApplications);

    return response
      .status(200)
      .send({message: `Sent ${emailsSent} soon to expire licence with no return reminder emails.`});
  } catch (error) {
    jsonConsoleLogger.error(unErrorJson(error));
    return response.status(500).send({error});
  }
});

v2router.get('/applications/:id/login', async (request, response) => {
  // Try to parse the incoming ID to make sure it's really a number.
  const existingId = Number(request.params.id);
  const idInvalid = Number.isNaN(existingId);

  // Check if there's an application allocated at the specified ID.
  const existingApplication = await ApplicationController.findOne(existingId);
  const idNotFound = existingApplication === undefined || existingApplication === null;

  // Check that the visitor's given us a postcode.
  const {postcode} = request.query;
  const postcodeInvalid = postcode === undefined;

  // Check that the visitor's supplied postcode matches their stored one.
  const postcodeIncorrect =
    existingApplication !== undefined &&
    existingApplication !== null &&
    !postcodesMatch(existingApplication.addressPostcode, postcode);

  // Check that the visitor's given us a base url.
  const {redirectBaseUrl} = request.query;
  const urlInvalid = redirectBaseUrl === undefined || redirectBaseUrl === null;

  // As long as we're happy that the visitor's provided use with valid
  // information, build them a token for logging in with.
  let token;
  if (!idInvalid && !idNotFound && !postcodeInvalid && !postcodeIncorrect) {
    token = buildToken(jwk.getPrivateKey(), existingId);
  }

  // If the visitor has give us enough information, build them a link that will
  // allow them to click-to-log-in.
  let loginLink;
  if (!urlInvalid && token !== undefined) {
    loginLink = `${redirectBaseUrl}${token}`;
  }

  // As long as we've managed to build a login link, send the visitor an email
  // with that link included.
  if (loginLink !== undefined) {
    try {
      await EmailService.sendLoginEmail(
        existingApplication.emailAddress,
        loginLink,
        existingId,
        existingApplication.fullName
      );
    } catch (error) {
      console.error('Notify service returned an error:', error.message);
      // Return 500 Internal Server error.
      return response.status(500).send();
    }
  }

  // If we're in production, no matter what, tell the API consumer that everything went well.
  if (process.env.NODE_ENV === 'production') {
    return response.status(200).send();
  }

  // If we're in development mode, send back a debug message, with the link for
  // the developer, to avoid sending unnecessary emails.
  return response.status(200).send({
    idInvalid,
    idNotFound,
    postcodeInvalid,
    postcodeIncorrect,
    urlInvalid,
    token,
    loginLink
  });
});

// Allow an API consumer to retrieve the public half of our ECDSA key to
// validate our signed JWTs.
v2router.get('/public-key', async (request, response) => response.status(200).send(jwk.getPublicKey()));

/**
 * Build a JWT to allow a visitor to log in to the supply a return flow.
 *
 * @param {string} jwtPrivateKey
 * @param {string} id
 * @returns {string} a signed JWT
 */
const buildToken = (jwtPrivateKey, id) =>
  jwt.sign({}, jwtPrivateKey, {subject: `${id}`, algorithm: 'ES256', expiresIn: '30m', noTimestamp: true});

/**
 * Test if two postcodes match.
 *
 * A match is when the alphanumeric characters in the supplied strings equal
 * each other once all other characters have been removed and everything's been
 * transformed to lower-case. It's extreme, but ' !"£IV3$%^8NW&*( ' should match
 * 'iv3 8nw'.
 *
 * @param {string} postcode1 a postcode to check
 * @param {string} postcode2 the other postcode to check
 * @returns {boolean} true if they kinda match, false otherwise
 */
const postcodesMatch = (postcode1, postcode2) => {
  // Regex that matches any and all non alpha-num characters.
  const notAlphaNumber = /[^a-z\d]/gi;

  // Clean our two strings to the 'same' representation.
  const cleanPostcode1 = postcode1.replaceAll(notAlphaNumber, '').toLocaleLowerCase();
  const cleanPostcode2 = postcode2.replaceAll(notAlphaNumber, '').toLocaleLowerCase();

  // Check if they match, now that they're clean.
  return cleanPostcode1 === cleanPostcode2;
};

export {v2router as default};
