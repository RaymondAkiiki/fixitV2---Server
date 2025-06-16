AuditLog.js
    action: 
    user:
    targetModel: 
    targetId:    
    details:
    ipAddress:
    timestamps:

comment.js 
    contextType:
    contextId: 
    sender:
    message:
    timestamps:

invite.js 
    email:
    role: 
    property: 
    unit:
    token:  
    generatedBy:
    status:
    expiresAt:
    acceptedBy:

media.js 
  filename: 
  originalname: 
  mimeType:
  size: 
  uploadDate: 
  uploadedBy: 
  relatedTo: 
  relatedId: 
  filePath: 
  description: 
  url:
  timestamps: 

notification.js
  recipient:
  sender: 
  message:
  link: 
  isRead:
  type: { enum: ['new_request', 'status_update', 'new_comment', 'assignment', 'reminder_due', 'reminder_overdue', 'invite_received', 'task_completed', 'task_verified'], required: true },
  relatedResource: { kind: String,   item: { type: mongoose.Schema.Types.ObjectId, refPath: 'relatedResource.kind' }  },
  timestamps:


property.js 
  name:
  address: 
  landlord:
  property_manag:
  units: 
  details: 
  tenants: 
  createdBy: 
  timestamps:

propertyUser. js 
    user: 
    property: 
    unit: 
    roles:  
    inviteStatus: 
    invitedBy:
    timestamps:  

request.js 
  title: 
  description: 
  category:
  priority:
  images: 
  status: 
  property: 
  unit: 
  createdBy: 
  assignedTo: 
  assignedBy: 
  resolvedAt: 
  comments: 
      sender: 
      message: 
      timestamp:     
  approvedBy: 
  tenantRef: 
  feedback: 
     rating: 
     comment: 
     submittedAt: 
  publicToken: 
  publicLinkEnabled:
  publicLinkExpiresAt:
  timestamps:


ScheduledMaintenance.js 
  title: 
  description: 
  category: 
  property: 
  unit:
  scheduledDate: 
  recurring:   
  status:
  assignedTo:
  createdBy:
  media:
  comments: 
    user: 
    text:
    isInternalNote: 
    timestamp: 
  publicLinkToken: 
  publicLinkExpires: 
  publicLinkEnabled: 
  frequency: 
    frequency: 
    interval: 
    dayOfWeek: 
    dayOfMonth: 
    monthOfYear: 
 timestamps: 

unit.js

  unitName: 
  floor: 
  details: 
  property: 
  tenant:  
  timestamps:


user.js 

  name: 
  phone: 
  email: 
  passwordHash: 
  isActive:
  lastVisit: 
  role: 
  resetPasswordToken: 
  resetPasswordExpires: 
  approved:  
  properties: 
  units: 
  pendingInvites: 
  propertiesManaged:
  propertiesOwned:
  tenancies: 
    property:
    unit: 
  inviteToken: 
  inviteTokenExpires: 
  timestamps:


vendor.js 
  name:
  phone: 
  email:
  address:
  description:
  services: 
  properties:
  addedBy: 
  timestamps:
