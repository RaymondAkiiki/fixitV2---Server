// backend/controllers/dashboardController.js

const Property = require('../models/property');
const Request = require('../models/request');
const User = require('../models/user');
const Lease = require('../models/lease');
const Rent = require('../models/rent');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Unit = require('../models/unit');
const PropertyUser = require('../models/propertyUser');
const mongoose = require('mongoose');
const { REQUEST_STATUS_ENUM, LEASE_STATUS_ENUM, SCHEDULED_MAINTENANCE_STATUS_ENUM } = require('../utils/constants/enums');

/**
 * Get aggregated data for the PM dashboard in a single query
 */
exports.getPMDashboardData = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find properties managed by this PM using PropertyUser model
    const propertyUserAssociations = await PropertyUser.find({ 
      user: userId, 
      roles: 'propertymanager',
      isActive: true 
    });
    
    const propertyIds = propertyUserAssociations.map(pu => pu.property);
    
    if (propertyIds.length === 0) {
      return res.json({
        stats: {
          properties: 0,
          units: 0,
          tenants: 0,
          openRequests: 0,
          activeLeases: 0,
          upcomingRentDue: 0,
          upcomingMaintenance: 0
        },
        recentRequests: [],
        commonIssues: [],
        recentLeases: [],
        recentRents: [],
        upcomingMaintenanceTasks: []
      });
    }
    
    // For better performance, execute queries in parallel
    const [
      properties,
      requests,
      commonIssuesResult,
      tenantCount,
      leases,
      rents,
      scheduledMaintenance,
      totalUnitsResult,
      openRequestsCount,
      activeLeasesCount,
      upcomingRentDueCount,
      upcomingMaintenanceCount
    ] = await Promise.all([
      // Get basic property data
      Property.find({ _id: { $in: propertyIds }, isActive: true })
        .select('name address')
        .lean(),
      
      // Recent requests
      Request.find({ 
        property: { $in: propertyIds },
        isActive: true 
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('property', 'name')
        .lean(),
      
      // Common issues aggregation
      Request.aggregate([
        { $match: { 
          property: { $in: propertyIds },
          isActive: true 
        }},
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 3 }
      ]),
      
      // Count tenants associated with these properties
      PropertyUser.countDocuments({ 
        property: { $in: propertyIds }, 
        roles: 'tenant',
        isActive: true 
      }),
      
      // Recent leases
      Lease.find({ 
        property: { $in: propertyIds },
        isActive: true 
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .lean(),
      
      // Recent rent payments
      Rent.find({ 
        property: { $in: propertyIds }
      })
        .sort({ dueDate: -1 })
        .limit(5)
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate({
          path: 'tenantPropertyUser',
          populate: {
            path: 'user',
            select: 'firstName lastName email'
          }
        })
        .lean(),
      
      // Upcoming scheduled maintenance
      ScheduledMaintenance.find({ 
        property: { $in: propertyIds },
        scheduledDate: { $gte: new Date() },
        status: { $nin: ['completed', 'canceled'] }
      })
        .sort({ scheduledDate: 1 })
        .limit(5)
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .lean(),
      
      // Count total units
      Unit.countDocuments({ property: { $in: propertyIds }, isActive: true }),
      
      // Count open requests
      Request.countDocuments({
        property: { $in: propertyIds },
        status: { $nin: ['completed', 'verified', 'canceled', 'archived'] },
        isActive: true
      }),
      
      // Count active leases
      Lease.countDocuments({
        property: { $in: propertyIds },
        status: 'active',
        isActive: true
      }),
      
      // Count upcoming rent due
      Rent.countDocuments({
        property: { $in: propertyIds },
        status: { $in: ['due', 'overdue'] }
      }),
      
      // Count upcoming maintenance tasks
      ScheduledMaintenance.countDocuments({
        property: { $in: propertyIds },
        scheduledDate: { $gte: new Date() },
        status: { $nin: ['completed', 'canceled'] }
      })
    ]);
    
    // Process rent data to ensure tenant info is included
    const processedRents = rents.map(rent => {
      return {
        ...rent,
        tenant: rent.tenantPropertyUser?.user || null
      };
    });
    
    // Format and return the dashboard data
    res.json({
      stats: {
        properties: properties.length,
        units: totalUnitsResult,
        tenants: tenantCount,
        openRequests: openRequestsCount,
        activeLeases: activeLeasesCount,
        upcomingRentDue: upcomingRentDueCount,
        upcomingMaintenance: upcomingMaintenanceCount
      },
      recentRequests: requests,
      commonIssues: commonIssuesResult,
      recentLeases: leases,
      recentRents: processedRents,
      upcomingMaintenanceTasks: scheduledMaintenance
    });
    
  } catch (error) {
    console.error('Error fetching PM dashboard data:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data', error: error.message });
  }
};

/**
 * Get aggregated data for the Landlord dashboard in a single query
 */
exports.getLandlordDashboardData = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find properties owned by this landlord using PropertyUser model
    const propertyUserAssociations = await PropertyUser.find({ 
      user: userId, 
      roles: 'landlord',
      isActive: true 
    });
    
    const propertyIds = propertyUserAssociations.map(pu => pu.property);
    
    if (propertyIds.length === 0) {
      return res.json({
        stats: {
          properties: 0,
          units: 0,
          tenants: 0,
          openRequests: 0,
          activeLeases: 0,
          upcomingRentDue: 0,
          upcomingMaintenance: 0
        },
        recentRequests: [],
        commonIssues: [],
        recentLeases: [],
        recentRents: [],
        upcomingMaintenanceTasks: []
      });
    }
    
    // Execute queries in parallel - same pattern as PM but filtered for landlord's properties
    const [
      properties,
      requests,
      commonIssuesResult,
      tenantCount,
      leases,
      rents,
      scheduledMaintenance,
      totalUnitsResult,
      openRequestsCount,
      activeLeasesCount,
      upcomingRentDueCount,
      upcomingMaintenanceCount
    ] = await Promise.all([
      // Basic property data
      Property.find({ _id: { $in: propertyIds }, isActive: true })
        .select('name address')
        .lean(),
      
      // Recent requests
      Request.find({ 
        property: { $in: propertyIds },
        isActive: true 
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('property', 'name')
        .lean(),
      
      // Common issues aggregation
      Request.aggregate([
        { $match: { 
          property: { $in: propertyIds },
          isActive: true 
        }},
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 3 }
      ]),
      
      // Count tenants
      PropertyUser.countDocuments({ 
        property: { $in: propertyIds }, 
        roles: 'tenant',
        isActive: true 
      }),
      
      // Recent leases
      Lease.find({ 
        property: { $in: propertyIds },
        isActive: true 
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .lean(),
      
      // Recent rent payments
      Rent.find({ 
        property: { $in: propertyIds }
      })
        .sort({ dueDate: -1 })
        .limit(5)
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate({
          path: 'tenantPropertyUser',
          populate: {
            path: 'user',
            select: 'firstName lastName email'
          }
        })
        .lean(),
      
      // Upcoming scheduled maintenance
      ScheduledMaintenance.find({ 
        property: { $in: propertyIds },
        scheduledDate: { $gte: new Date() },
        status: { $nin: ['completed', 'canceled'] }
      })
        .sort({ scheduledDate: 1 })
        .limit(5)
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .lean(),
      
      // Count total units
      Unit.countDocuments({ property: { $in: propertyIds }, isActive: true }),
      
      // Count open requests
      Request.countDocuments({
        property: { $in: propertyIds },
        status: { $nin: ['completed', 'verified', 'canceled', 'archived'] },
        isActive: true
      }),
      
      // Count active leases
      Lease.countDocuments({
        property: { $in: propertyIds },
        status: 'active',
        isActive: true
      }),
      
      // Count upcoming rent due
      Rent.countDocuments({
        property: { $in: propertyIds },
        status: { $in: ['due', 'overdue'] }
      }),
      
      // Count upcoming maintenance tasks
      ScheduledMaintenance.countDocuments({
        property: { $in: propertyIds },
        scheduledDate: { $gte: new Date() },
        status: { $nin: ['completed', 'canceled'] }
      })
    ]);
    
    // Process rent data to ensure tenant info is included
    const processedRents = rents.map(rent => {
      return {
        ...rent,
        tenant: rent.tenantPropertyUser?.user || null
      };
    });
    
    res.json({
      stats: {
        properties: properties.length,
        units: totalUnitsResult,
        tenants: tenantCount,
        openRequests: openRequestsCount,
        activeLeases: activeLeasesCount,
        upcomingRentDue: upcomingRentDueCount,
        upcomingMaintenance: upcomingMaintenanceCount
      },
      recentRequests: requests,
      commonIssues: commonIssuesResult,
      recentLeases: leases,
      recentRents: processedRents,
      upcomingMaintenanceTasks: scheduledMaintenance
    });
    
  } catch (error) {
    console.error('Error fetching Landlord dashboard data:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data', error: error.message });
  }
};

/**
 * Get aggregated data for the Tenant dashboard in a single query
 */
exports.getTenantDashboardData = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find tenancies for this tenant
    const tenancies = await PropertyUser.find({ 
      user: userId, 
      roles: 'tenant',
      isActive: true 
    });
    
    if (tenancies.length === 0) {
      return res.json({
        profile: null,
        recentRequests: [],
        notifications: [],
        myProperties: [],
        upcomingMaintenance: [],
        leases: [],
        rents: []
      });
    }
    
    // Get property IDs and unit IDs from tenancies
    const propertyIds = tenancies.map(t => t.property);
    const unitIds = tenancies.filter(t => t.unit).map(t => t.unit);
    
    const [
      profile,
      requests,
      leases,
      properties,
      units,
      scheduledMaintenance,
      rents
    ] = await Promise.all([
      // User profile data
      User.findById(userId).select('firstName lastName email phone avatar'),
      
      // Tenant's maintenance requests
      Request.find({ 
        createdByPropertyUser: { $in: tenancies.map(t => t._id) },
        isActive: true 
      })
        .sort({ createdAt: -1 })
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .lean(),
      
      // Tenant's leases
      Lease.find({ 
        tenant: userId,
        isActive: true 
      })
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('landlord', 'firstName lastName email')
        .lean(),
      
      // Properties associated with tenant
      Property.find({ 
        _id: { $in: propertyIds },
        isActive: true 
      })
        .select('name address location images')
        .lean(),
      
      // Units associated with tenant
      Unit.find({ 
        _id: { $in: unitIds },
        isActive: true 
      })
        .populate('property', 'name')
        .lean(),
      
      // Upcoming scheduled maintenance for tenant's units
      ScheduledMaintenance.find({ 
        $or: [
          { property: { $in: propertyIds }, unit: null }, // Property-wide maintenance
          { unit: { $in: unitIds } } // Unit-specific maintenance
        ],
        scheduledDate: { $gte: new Date() },
        status: { $nin: ['completed', 'canceled'] }
      })
        .sort({ scheduledDate: 1 })
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .lean(),
      
      // Tenant's rent records
      Rent.find({
        tenantPropertyUser: { $in: tenancies.map(t => t._id) }
      })
        .sort({ dueDate: -1 })
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('lease')
        .lean()
    ]);
    
    // Process the data for tenant dashboard
    const tenantData = {
      profile,
      recentRequests: requests,
      myProperties: properties.map(p => {
        // Find the tenant's unit in this property
        const propertyUnits = units.filter(u => 
          u.property && u.property._id && 
          p._id && 
          u.property._id.toString() === p._id.toString()
        );
        
        return {
          ...p,
          units: propertyUnits
        };
      }),
      upcomingMaintenance: scheduledMaintenance,
      leases,
      rents
    };
    
    res.json(tenantData);
    
  } catch (error) {
    console.error('Error fetching Tenant dashboard data:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data', error: error.message });
  }
};

/**
 * Get aggregated data for the Admin dashboard in a single query
 */
exports.getAdminDashboardData = async (req, res) => {
  try {
    // For admin, we'll get system-wide statistics
    const [
      userStats,
      propertyStats,
      leaseStats,
      requestStats,
      vendorStats,
      unitStats,
      userRoleDistribution,
      pendingApprovals,
      recentActivity
    ] = await Promise.all([
      // User statistics
      User.aggregate([
        { $group: { _id: null, total: { $sum: 1 } } }
      ]),
      
      // Property statistics
      Property.aggregate([
        { $group: { _id: null, total: { $sum: 1 } } }
      ]),
      
      // Lease statistics
      Lease.aggregate([
        { 
          $group: { 
            _id: '$status',
            count: { $sum: 1 } 
          }
        }
      ]),
      
      // Request statistics
      Request.aggregate([
        { 
          $group: { 
            _id: '$status',
            count: { $sum: 1 } 
          }
        }
      ]),
      
      // Vendor statistics (from your Vendor model)
      mongoose.model('Vendor').countDocuments(),
      
      // Unit statistics
      Unit.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      
      // User role distribution
      User.aggregate([
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Pending user approvals
      User.find({ 
        registrationStatus: 'pending_approval',
        isActive: true 
      })
        .select('firstName lastName email role registrationStatus createdAt')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      
      // Recent activity from audit logs (if available) or recent changes
      mongoose.model('AuditLog')
        .find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
        .catch(() => []) // Gracefully handle if AuditLog model doesn't exist
    ]);
    
    // Process statistics
    const totalUsers = userStats.length > 0 ? userStats[0].total : 0;
    const totalProperties = propertyStats.length > 0 ? propertyStats[0].total : 0;
    
    // Process lease stats
    const leaseStatusCounts = {};
    leaseStats.forEach(stat => {
      leaseStatusCounts[stat._id] = stat.count;
    });
    const totalLeases = Object.values(leaseStatusCounts).reduce((sum, count) => sum + count, 0);
    
    // Process request stats
    const requestStatusCounts = {};
    requestStats.forEach(stat => {
      requestStatusCounts[stat._id] = stat.count;
    });
    const pendingRequests = requestStats
      .filter(stat => !['completed', 'verified', 'canceled', 'archived'].includes(stat._id))
      .reduce((sum, stat) => sum + stat.count, 0);
    
    // Process unit stats
    const unitStatusCounts = {};
    unitStats.forEach(stat => {
      unitStatusCounts[stat._id] = stat.count;
    });
    const totalUnits = Object.values(unitStatusCounts).reduce((sum, count) => sum + count, 0);
    const occupiedUnits = unitStatusCounts['occupied'] || 0;
    const vacantUnits = unitStatusCounts['vacant'] || 0;
    
    // Format the admin dashboard data
    const adminData = {
      stats: {
        totalUsers,
        totalProperties,
        totalLeases,
        pendingRequests,
        totalVendors: vendorStats,
        totalUnits,
        occupiedUnits,
        vacantUnits
      },
      userRoleDistribution: userRoleDistribution.map(role => ({
        role: role._id,
        count: role.count
      })),
      pendingApprovals,
      recentActivity: recentActivity.map(activity => ({
        id: activity._id,
        action: activity.action,
        resourceType: activity.resourceType,
        timestamp: activity.createdAt,
        user: activity.user,
        message: activity.description || `${activity.action} on ${activity.resourceType}`
      }))
    };
    
    res.json(adminData);
    
  } catch (error) {
    console.error('Error fetching Admin dashboard data:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data', error: error.message });
  }
};

/**
 * Get detailed data for a specific dashboard section
 */
exports.getDashboardSection = async (req, res) => {
  try {
    const { section } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    
    // Get accessible properties based on user role
    let propertyIds = [];
    
    if (userRole === 'admin') {
      // Admin has access to all properties
      const allProperties = await Property.find({}).select('_id');
      propertyIds = allProperties.map(p => p._id);
    } else {
      // Get properties based on PropertyUser associations
      const propertyUserAssociations = await PropertyUser.find({
        user: userId,
        isActive: true
      });
      
      propertyIds = propertyUserAssociations.map(pu => pu.property);
    }
    
    // If no properties are accessible, return empty data
    if (propertyIds.length === 0 && userRole !== 'tenant') {
      return res.json([]);
    }
    
    let data = [];
    
    // Fetch the appropriate data based on the requested section
    switch (section) {
      case 'leases':
        if (userRole === 'tenant') {
          data = await Lease.find({ tenant: userId, isActive: true })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('landlord', 'firstName lastName email')
            .lean();
        } else {
          data = await Lease.find({ property: { $in: propertyIds }, isActive: true })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .lean();
        }
        break;
        
      case 'rents':
        if (userRole === 'tenant') {
          // For tenants, find rents through their property user associations
          const tenancies = await PropertyUser.find({ 
            user: userId, 
            roles: 'tenant',
            isActive: true 
          });
          
          data = await Rent.find({ tenantPropertyUser: { $in: tenancies.map(t => t._id) } })
            .sort({ dueDate: -1 })
            .limit(10)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate({
              path: 'tenantPropertyUser',
              populate: {
                path: 'user',
                select: 'firstName lastName email'
              }
            })
            .lean();
        } else {
          data = await Rent.find({ property: { $in: propertyIds } })
            .sort({ dueDate: -1 })
            .limit(10)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate({
              path: 'tenantPropertyUser',
              populate: {
                path: 'user',
                select: 'firstName lastName email'
              }
            })
            .lean();
        }
        
        // Process tenant data
        data = data.map(rent => ({
          ...rent,
          tenant: rent.tenantPropertyUser?.user || null
        }));
        break;
        
      case 'maintenance':
        if (userRole === 'tenant') {
          // For tenants, find their units first
          const tenancies = await PropertyUser.find({ 
            user: userId, 
            roles: 'tenant',
            isActive: true 
          });
          
          const unitIds = tenancies.filter(t => t.unit).map(t => t.unit);
          const tenantPropertyIds = tenancies.map(t => t.property);
          
          data = await ScheduledMaintenance.find({ 
            $or: [
              { property: { $in: tenantPropertyIds }, unit: null }, // Property-wide maintenance
              { unit: { $in: unitIds } } // Unit-specific maintenance
            ],
            scheduledDate: { $gte: new Date() },
            status: { $nin: ['completed', 'canceled'] }
          })
            .sort({ scheduledDate: 1 })
            .limit(10)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .lean();
        } else {
          data = await ScheduledMaintenance.find({ 
            property: { $in: propertyIds },
            scheduledDate: { $gte: new Date() },
            status: { $nin: ['completed', 'canceled'] }
          })
            .sort({ scheduledDate: 1 })
            .limit(10)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .lean();
        }
        break;
        
      case 'requests':
        if (userRole === 'tenant') {
          // Find property user associations for this tenant
          const tenancies = await PropertyUser.find({ 
            user: userId, 
            roles: 'tenant',
            isActive: true 
          });
          
          data = await Request.find({ 
            createdByPropertyUser: { $in: tenancies.map(t => t._id) },
            isActive: true 
          })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .lean();
        } else {
          data = await Request.find({ 
            property: { $in: propertyIds },
            isActive: true 
          })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .lean();
        }
        break;
        
      default:
        return res.status(400).json({ message: 'Invalid section requested' });
    }
    
    res.json(data);
    
  } catch (error) {
    console.error(`Error fetching dashboard section ${req.params.section}:`, error);
    res.status(500).json({ message: 'Failed to fetch section data', error: error.message });
  }
};