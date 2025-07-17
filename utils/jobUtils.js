/**
 * Calculates the next due date based on the frequency object.
 * @param {Date} lastDate - The last date a task was due or generated.
 * @param {object} frequency - The frequency object from ScheduledMaintenance schema.
 * @returns {Date | null} The calculated next due date, or null if recurrence ends.
 */
const calculateNextDueDate = (lastDate, frequency) => {
    let nextDate = new Date(lastDate);
    nextDate.setHours(0, 0, 0, 0);

    if (!frequency || !frequency.type) {
        return null;
    }

    const interval = frequency.interval || 1;

    switch (frequency.type) {
        case 'daily':
            nextDate.setDate(nextDate.getDate() + interval);
            break;
        case 'weekly':
            nextDate.setDate(nextDate.getDate() + (interval * 7));
            if (frequency.dayOfWeek && frequency.dayOfWeek.length > 0) {
                let foundNext = false;
                for (let i = 0; i < 7; i++) {
                    const tempDate = new Date(nextDate);
                    tempDate.setDate(tempDate.getDate() + i);
                    if (frequency.dayOfWeek.includes(tempDate.getDay())) {
                        nextDate = tempDate;
                        foundNext = true;
                        break;
                    }
                }
                if (!foundNext) {
                    nextDate.setDate(nextDate.getDate() + (interval * 7));
                    nextDate.setHours(0,0,0,0);
                }
            }
            break;
        case 'bi_weekly':
            nextDate.setDate(nextDate.getDate() + (interval * 14));
            break;
        case 'monthly':
            nextDate.setMonth(nextDate.getMonth() + interval);
            if (frequency.dayOfMonth && frequency.dayOfMonth.length > 0) {
                const targetDay = Math.min(frequency.dayOfMonth[0], new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate());
                nextDate.setDate(targetDay);
            }
            break;
        case 'quarterly':
            nextDate.setMonth(nextDate.getMonth() + (interval * 3));
            break;
        case 'annually':
            nextDate.setFullYear(nextDate.getFullYear() + interval);
            if (frequency.monthOfYear && frequency.monthOfYear.length > 0) {
                nextDate.setMonth(frequency.monthOfYear[0] - 1);
            }
            if (frequency.dayOfMonth && frequency.dayOfMonth.length > 0) {
                const targetDay = Math.min(frequency.dayOfMonth[0], new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate());
                nextDate.setDate(targetDay);
            }
            break;
        case 'once':
            return null;
        case 'custom_days':
            nextDate.setDate(nextDate.getDate() + (frequency.customDays[0] || 1));
            break;
        default:
            console.warn(`jobUtils: Unknown frequency type encountered: ${frequency.type}`);
            return null;
    }

    if (frequency.endDate && nextDate > frequency.endDate) {
        return null;
    }

    return nextDate;
};

module.exports = { calculateNextDueDate };