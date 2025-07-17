// my-app\server\utils\validationUtils.js

const { check, validationResult, body } = require('express-validator');
const logger = require('./logger');
const AppError = require('./AppError');
const { SERVICE_TYPE_ENUM, CATEGORY_ENUM, USER_TYPE_ENUM, PRIORITY_ENUM, REQUEST_STATUS_ENUM, ASSIGNED_TO_MODEL_ENUM, FREQUENCY_TYPE_ENUM, SCHEDULED_MAINTENANCE_STATUS_ENUM, UNIT_STATUS_ENUM, UTILITY_RESPONSIBILITY_ENUM  } = require('./constants/enums');
const { SERVICE_ENUM } = require('./constants/enums');

/**
 * Centralized validation result handler.
 */
const validateResult = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const extractedErrors = errors.array().map(err => ({
            field: err.path,
            message: err.msg,
            value: err.value
        }));
        logger.warn(`Validation failed for request to ${req.path}. Errors: ${JSON.stringify(extractedErrors)}`);
        throw new AppError('Validation failed', 400, extractedErrors);
    }
    next();
};

const emailValidator = [
    check('email')
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email address')
        .normalizeEmail()
];

const passwordValidator = [
    check('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&).')
];

const phoneValidator = [
    check('phone')
        .notEmpty().withMessage('Phone number is required')
        .isMobilePhone('any').withMessage('Please provide a valid phone number')
        .trim()
];

// Define validateUserRegistration - I'm assuming you have the checks for it
const validateUserRegistration = [
    check('firstName').notEmpty().withMessage('First name is required'),
    check('lastName').notEmpty().withMessage('Last name is required'),
    ...emailValidator, // Reuse email validation
    ...passwordValidator, // Reuse password validation
    ...phoneValidator, // Reuse phone validation
    // Add any other specific validation checks for registration (e.g., role, etc.)
    validateResult // Make sure this is the last validator in the chain
];


const validateMongoId = (idFieldName = 'id') => [
    check(idFieldName)
        .notEmpty().withMessage(`${idFieldName} is required`)
        .isMongoId().withMessage(`Invalid ${idFieldName} format. Must be a valid MongoDB ObjectId.`)
];

const dateValidator = (fieldName) => [
    check(fieldName)
        .notEmpty().withMessage(`${fieldName} is required`)
        .isISO8601().toDate().withMessage(`Invalid date format for ${fieldName}. Use YYYY-MM-DD.`)
];

const numberValidator = (fieldName) => [
    check(fieldName)
        .notEmpty().withMessage(`${fieldName} is required`)
        .isNumeric().withMessage(`${fieldName} must be a number`)
        .toFloat()
];

const serviceTypeValidator = [
    check('services')
        .isArray().withMessage('Services must be an array')
        .notEmpty().withMessage('At least one service is required')
        .custom(value => {
            if (!Array.isArray(value)) {
                throw new Error('Services must be an array.');
            }
            const invalidServices = value.filter(service => !Object.values(SERVICE_TYPE_ENUM).includes(service));
            if (invalidServices.length > 0) {
                throw new Error(`Invalid service types: ${invalidServices.join(', ')}. Allowed types are: ${Object.values(SERVICE_TYPE_ENUM).join(', ')}.`);
            }
            return true;
        })
];

const userTypeValidator = [
    check('userType')
        .notEmpty().withMessage('User type is required')
        .custom(value => {
            if (!Object.values(USER_TYPE_ENUM).includes(value)) {
                throw new Error(`Invalid user type: ${value}. Allowed types are: ${Object.values(USER_TYPE_ENUM).join(', ')}.`);
            }
            return true;
        })
];

const validateVendor = [
    check('name')
        .notEmpty().withMessage('Vendor name is required.')
        .isLength({ max: 100 }).withMessage('Vendor name cannot exceed 100 characters.'),
    
    ...phoneValidator, // Reuse phone validation
    
    // Email is required and unique in schema, so validate it here
    check('email')
        .notEmpty().withMessage('Vendor email is required.')
        .isEmail().withMessage('Please provide a valid email address.')
        .normalizeEmail(),

    check('address.street')
        .optional() // Address is an embedded document, its fields might be optional on update
        .isString().trim().withMessage('Street must be a string.'),
    check('address.city')
        .optional()
        .isString().trim().withMessage('City must be a string.'),
    check('address.state')
        .optional()
        .isString().trim().withMessage('State must be a string.'),
    check('address.zipCode')
        .optional()
        .isString().trim().withMessage('Zip Code must be a string.'),
    check('address.country')
        .optional()
        .isString().trim().withMessage('Country must be a string.'),

    check('description')
        .optional({ nullable: true }) // Allow null or undefined
        .isString().withMessage('Description must be a string.')
        .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),

    check('services')
        .notEmpty().withMessage('At least one service is required for the vendor.')
        .isArray().withMessage('Services must be an array.')
        .custom(value => {
            if (!Array.isArray(value)) {
                throw new Error('Services must be an array.');
            }
            const allowedServices = SERVICE_ENUM.map(s => s.toLowerCase());
            const invalidServices = value.filter(service => !allowedServices.includes(service.toLowerCase()));
            if (invalidServices.length > 0) {
                throw new Error(`Invalid service types: ${invalidServices.join(', ')}. Allowed types are: ${SERVICE_ENUM.join(', ')}.`);
            }
            return true;
        }),
    
    check('contactPerson')
        .optional({ nullable: true })
        .isString().trim().withMessage('Contact person must be a string.'),

    check('fixedCalloutFee')
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage('Fixed callout fee must be a non-negative number.'),

    check('paymentTerms')
        .optional({ nullable: true })
        .isString().trim().withMessage('Payment terms must be a string.'),

    // // Assuming STATUS_ENUM is also available from your enums
    // check('status')
    //     .optional()
    //     .isIn(['active', 'inactive', 'preferred']).withMessage('Invalid status. Must be active, inactive, or preferred.')
    //     .toLowerCase(),

    // check('companyName')
    //     .optional({ nullable: true })
    //     .isString().trim().withMessage('Company name must be a string.'),

    // check('licenseNumber')
    //     .optional({ nullable: true })
    //     .isString().trim().withMessage('License number must be a string.'),

    // check('insuranceDetails')
    //     .optional({ nullable: true })
    //     .isString().trim().withMessage('Insurance details must be a string.'),

    // check('notes')
    //     .optional({ nullable: true })
    //     .isString().trim().withMessage('Notes must be a string.'),

    // addedBy is typically set by the backend based on the authenticated user,
    // so it might not need to be validated from the request body.
    // If it is sent from the front-end, it should be a MongoId.
    // check('addedBy')
    //     .notEmpty().withMessage('AddedBy user is required.')
    //     .isMongoId().withMessage('Invalid addedBy user ID format.'),

    // check('associatedProperties')
    //     .optional()
    //     .isArray().withMessage('Associated properties must be an array.')
    //     .custom(value => {
    //         if (!Array.isArray(value)) {
    //             throw new Error('Associated properties must be an array.');
    //         }
    //         const invalidIds = value.filter(id => !mongoose.Types.ObjectId.isValid(id));
    //         if (invalidIds.length > 0) {
    //             throw new Error('Some associated property IDs are invalid.');
    //         }
    //         return true;
    //     }),
    
    // documents are typically handled by file uploads, not direct body fields.
    // If they are passed as IDs, similar MongoId validation for each element in array.
    // check('documents')
    //     .optional()
    //     .isArray().withMessage('Documents must be an array.')
    //     .custom(value => {
    //         if (!Array.isArray(value)) {
    //             throw new Error('Documents must be an array.');
    //         }
    //         const invalidIds = value.filter(id => !mongoose.Types.ObjectId.isValid(id));
    //         if (invalidIds.length > 0) {
    //             throw new Error('Some document IDs are invalid.');
    //         }
    //         return true;
    //     }),
    validateResult // This should always be the last validator
];

const validateRequest = [
    // title
    check('title')
        .notEmpty().withMessage('Request title is required.')
        .isString().withMessage('Title must be a string.')
        .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters.'),

    // description
    check('description')
        .notEmpty().withMessage('Description is required for the request.')
        .isString().withMessage('Description must be a string.')
        .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters.'),

    // category
    check('category')
        .notEmpty().withMessage('Category is required.')
        .isIn(CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${CATEGORY_ENUM.join(', ')}.`),

    // priority
    check('priority')
        .optional() // Default is 'low', so optional in body for creation
        .isIn(PRIORITY_ENUM).withMessage(`Invalid priority. Must be one of: ${PRIORITY_ENUM.join(', ')}.`),

    // property
    check('propertyId') // Assuming this comes as propertyId in the body
        .notEmpty().withMessage('Property is required for the request.')
        .isMongoId().withMessage('Invalid Property ID format.'),

    // unit (optional)
    check('unitId')
        .optional()
        .isMongoId().withMessage('Invalid Unit ID format if provided.'),

    // status (optional for creation, but can be updated)
    check('status')
        .optional()
        .isIn(REQUEST_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${REQUEST_STATUS_ENUM.join(', ')}.`),

    // assignedTo, assignedToModel, assignedBy, assignedAt, resolvedAt, completedBy, completedByModel, feedback, generatedFromScheduledMaintenance
    // These fields are typically managed by the backend logic and not directly submitted
    // in the initial create request or simple updates. If they are, you'll need to add
    // specific validation for them (e.g., isMongoId for IDs, isIn for enums).

    // publicLinkEnabled, publicLinkExpiresAt - managed by specific public link endpoints

    // Final validation result handler
    validateResult
];
/**
 * Validation middleware for Scheduled Maintenance creation and updates.
 */
const validateScheduledMaintenance = [
    // --- Basic Fields ---
    check('title')
        .notEmpty().withMessage('Title is required for scheduled maintenance.')
        .isString().withMessage('Title must be a string.')
        .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters.'),

    check('description')
        .notEmpty().withMessage('Description is required for scheduled maintenance.')
        .isString().withMessage('Description must be a string.')
        .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters.'),

    check('category')
        .notEmpty().withMessage('Category is required.')
        .isIn(CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${CATEGORY_ENUM.join(', ')}.`),

    check('property') // This is the field name from the Mongoose model/schema
        .notEmpty().withMessage('Property is required for scheduled maintenance.')
        .isMongoId().withMessage('Invalid Property ID format.'),

    check('unit')
        .optional({ nullable: true }) // Allow null or undefined
        .isMongoId().withMessage('Invalid Unit ID format if provided.'),

    check('scheduledDate')
        .notEmpty().withMessage('Scheduled date is required.')
        .isISO8601().toDate().withMessage('Invalid date format for scheduledDate. Use YYYY-MM-DD.'),

    check('recurring')
        .optional() // Default is false, so optional if not provided
        .isBoolean().withMessage('Recurring must be a boolean (true/false).')
        .toBoolean(), // Convert to boolean type

    // --- Frequency (Conditional based on 'recurring' field) ---
    // Validate existence of frequency object if recurring is true
    check('frequency')
        .if(body('recurring').equals(true))
        .notEmpty().withMessage('Frequency details are required when recurring is true.')
        .bail() // Stop if frequency object is missing
        .custom((value, { req }) => {
            // Check for mutual exclusivity of endDate and occurrences within frequency
            if (value && value.endDate && value.occurrences) {
                throw new Error('Frequency cannot specify both "endDate" and "occurrences". Choose one or neither for infinite recurrence.');
            }
            return true;
        }),

    // Validate frequency.type
    check('frequency.type')
        .if(body('recurring').equals(true)) // Only validate if recurring is true
        .notEmpty().withMessage('Frequency type is required when recurring is true.')
        .isIn(FREQUENCY_TYPE_ENUM).withMessage(`Invalid frequency type. Must be one of: ${FREQUENCY_TYPE_ENUM.join(', ')}.`),

    // Validate frequency.interval
    check('frequency.interval')
        .if(body('recurring').equals(true)) // Only validate if recurring is true
        .optional() // Interval has a default in schema
        .isInt({ min: 1 }).withMessage('Frequency interval must be a positive integer.'),

    // Validate frequency.dayOfWeek (conditional on type === 'weekly')
    check('frequency.dayOfWeek')
        .if(body('frequency.type').equals('weekly'))
        .notEmpty().withMessage('For weekly recurrence, "dayOfWeek" is required.')
        .isArray({ min: 1 }).withMessage('Day of week must be an array.')
        .custom(value => value.every(num => typeof num === 'number' && num >= 0 && num <= 6))
        .withMessage('Day of week must be an array of numbers between 0 and 6.'),
    check('frequency.dayOfWeek') // Ensure it's null/undefined if not weekly to avoid extraneous data
        .if(body('frequency.type').not().equals('weekly'))
        .notEmpty().withMessage('Day of week should not be provided unless frequency type is "weekly".').bail(), // Bail if present and not weekly
    
    // Validate frequency.dayOfMonth (conditional on type === 'monthly' or 'yearly')
    check('frequency.dayOfMonth')
        .if(body('frequency.type').isIn(['monthly', 'yearly']))
        .notEmpty().withMessage('For monthly/yearly recurrence, "dayOfMonth" is required.')
        .isArray({ min: 1 }).withMessage('Day of month must be an array.')
        .custom(value => value.every(num => typeof num === 'number' && num >= 1 && num <= 31))
        .withMessage('Day of month must be an array of numbers between 1 and 31.'),
    check('frequency.dayOfMonth') // Ensure it's null/undefined if not monthly/yearly
        .if(body('frequency.type').not().isIn(['monthly', 'yearly']))
        .notEmpty().withMessage('Day of month should not be provided unless frequency type is "monthly" or "yearly".').bail(),

    // Validate frequency.monthOfYear (conditional on type === 'yearly')
    check('frequency.monthOfYear')
        .if(body('frequency.type').equals('yearly'))
        .notEmpty().withMessage('For yearly recurrence, "monthOfYear" is required.')
        .isArray({ min: 1 }).withMessage('Month of year must be an array.')
        .custom(value => value.every(num => typeof num === 'number' && num >= 1 && num <= 12))
        .withMessage('Month of year must be an array of numbers between 1 and 12.'),
    check('frequency.monthOfYear') // Ensure it's null/undefined if not yearly
        .if(body('frequency.type').not().equals('yearly'))
        .notEmpty().withMessage('Month of year should not be provided unless frequency type is "yearly".').bail(),

    // Validate frequency.customDays (conditional on type === 'custom')
    check('frequency.customDays')
        .if(body('frequency.type').equals('custom'))
        .notEmpty().withMessage('For custom recurrence, "customDays" is required.')
        .isArray({ min: 1 }).withMessage('Custom days must be an array.')
        .custom(value => value.every(num => typeof num === 'number' && num >= 0))
        .withMessage('Custom days must be an array of non-negative numbers.'),
    check('frequency.customDays') // Ensure it's null/undefined if not custom
        .if(body('frequency.type').not().equals('custom'))
        .notEmpty().withMessage('Custom days should not be provided unless frequency type is "custom".').bail(),


    // Validate frequency.endDate
    check('frequency.endDate')
        .optional({ nullable: true })
        .isISO8601().toDate().withMessage('Invalid endDate format for frequency. Use YYYY-MM-DD or ISO 8601.'),

    // Validate frequency.occurrences
    check('frequency.occurrences')
        .optional({ nullable: true })
        .isInt({ min: 1 }).withMessage('Occurrences must be a positive integer.'),

    // --- Other Optional Fields ---
    check('status')
        .optional() // Default is 'active'
        .isIn(SCHEDULED_MAINTENANCE_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${SCHEDULED_MAINTENANCE_STATUS_ENUM.join(', ')}.`),

    check('assignedTo')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid Assigned To ID format if provided.'),

    check('assignedToModel')
        .optional({ nullable: true })
        .if(body('assignedTo').exists({ checkFalsy: true })) // Only required if assignedTo is present
        .isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid Assigned To Model. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}.`),

    check('createdBy') // This is typically set by the backend, but if sent from frontend, validate
        .optional() // Or .notEmpty() if always expected in body for creation
        .isMongoId().withMessage('Invalid Created By ID format if provided.'),

    check('media')
        .optional()
        .isArray().withMessage('Media must be an array.')
        .custom(value => value.every(id => mongoose.Types.ObjectId.isValid(id))).withMessage('Invalid Media ID format in array.'),

    check('comments')
        .optional()
        .isArray().withMessage('Comments must be an array.')
        .custom(value => value.every(id => mongoose.Types.ObjectId.isValid(id))).withMessage('Invalid Comment ID format in array.'),

    check('publicLinkEnabled')
        .optional()
        .isBoolean().withMessage('Public link enabled must be a boolean.')
        .toBoolean(),

    check('lastGeneratedRequest')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid Last Generated Request ID format.'),
    check('nextDueDate')
        .optional({ nullable: true })
        .isISO8601().toDate().withMessage('Invalid date format for nextDueDate. Use YYYY-MM-DD.'),
    check('lastExecutedAt')
        .optional({ nullable: true })
        .isISO8601().toDate().withMessage('Invalid date format for lastExecutedAt. Use YYYY-MM-DD.'),
    check('nextExecutionAttempt')
        .optional({ nullable: true })
        .isISO8601().toDate().withMessage('Invalid date format for nextExecutionAttempt. Use YYYY-MM-DD.'),

    validateResult // Must be the last middleware to handle validation errors
];

/**
 * Validation middleware for Unit creation and updates.
 */
const validateUnit = [
    // unitName
    body('unitName')
        .notEmpty().withMessage('Unit name is required.')
        .isString().trim().withMessage('Unit name must be a string.')
        .isLength({ max: 50 }).withMessage('Unit name cannot exceed 50 characters.'),

    // floor
    body('floor')
        .optional({ nullable: true }) // Allow null or undefined
        .isString().trim().withMessage('Floor must be a string.')
        .isLength({ max: 20 }).withMessage('Floor number/name cannot exceed 20 characters.'),

    // details
    body('details')
        .optional({ nullable: true })
        .isString().trim().withMessage('Details must be a string.')
        .isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters.'),

    // property (required in model, but often passed as param in routes)
    // If you're using this validator for a POST request where 'property' is in the body, uncomment below:
    // body('property')
    //     .notEmpty().withMessage('Property ID is required for the unit.')
    //     .isMongoId().withMessage('Invalid Property ID format.'),
    // Note: In your routes, 'propertyId' is in params and validated separately with validateMongoId('propertyId').
    // This validator is for fields expected in the request body.

    // numBedrooms
    body('numBedrooms')
        .optional({ nullable: true })
        .isInt({ min: 0 }).withMessage('Number of bedrooms must be a non-negative integer.'),

    // numBathrooms
    body('numBathrooms')
        .optional({ nullable: true })
        .isInt({ min: 0 }).withMessage('Number of bathrooms must be a non-negative integer.'),

    // squareFootage
    body('squareFootage')
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage('Square footage must be a non-negative number.'),

    // rentAmount
    body('rentAmount')
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage('Rent amount must be a non-negative number.'),

    // depositAmount
    body('depositAmount')
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage('Deposit amount must be a non-negative number.'),

    // status
    body('status')
        .optional() // Has a default in schema
        .isIn(UNIT_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${UNIT_STATUS_ENUM.join(', ')}.`),

    // utilityResponsibility
    body('utilityResponsibility')
        .optional() // Has a default in schema
        .isIn(UTILITY_RESPONSIBILITY_ENUM).withMessage(`Invalid utility responsibility. Must be one of: ${UTILITY_RESPONSIBILITY_ENUM.join(', ')}.`),

    // notes
    body('notes')
        .optional({ nullable: true })
        .isString().trim().withMessage('Notes must be a string.')
        .isLength({ max: 2000 }).withMessage('Notes cannot exceed 2000 characters.'),

    // lastInspected
    body('lastInspected')
        .optional({ nullable: true })
        .isISO8601().toDate().withMessage('Invalid date format for last inspected date. Use ISO 8601 (YYYY-MM-DD).'),

    // unitImages (array of ObjectIds)
    body('unitImages')
        .optional()
        .isArray().withMessage('Unit images must be an array.')
        .custom(value => value.every(id => mongoose.Types.ObjectId.isValid(id))).withMessage('Invalid Unit Image ID format in array.'),

    validateResult // Must be the last middleware
];


module.exports = {
    check,
    validationResult,
    validateResult,
    emailValidator,
    passwordValidator,
    phoneValidator,
    validateMongoId,
    dateValidator,
    numberValidator,
    serviceTypeValidator,
    userTypeValidator,
    validateUserRegistration,
    validateVendor,
    validateRequest,
    validateScheduledMaintenance,
    validateUnit,
};