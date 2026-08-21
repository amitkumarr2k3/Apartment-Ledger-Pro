#!/bin/bash

LOG_FILE="/var/log/housekeeping.log"

echo "========================================" | tee -a $LOG_FILE
echo "Housekeeping Started: $(date)" | tee -a $LOG_FILE
echo "========================================" | tee -a $LOG_FILE

echo "Disk Usage Before Cleanup" | tee -a $LOG_FILE
df -h | tee -a $LOG_FILE

echo "Memory Usage Before Cleanup" | tee -a $LOG_FILE
free -h | tee -a $LOG_FILE

echo "Cleaning Docker Build Cache..." | tee -a $LOG_FILE
docker builder prune -af >> $LOG_FILE 2>&1

echo "Removing unused Docker objects..." | tee -a $LOG_FILE
docker system prune -af >> $LOG_FILE 2>&1

echo "Removing dangling volumes..." | tee -a $LOG_FILE
docker volume prune -f >> $LOG_FILE 2>&1

echo "Cleaning apt cache..." | tee -a $LOG_FILE
apt-get clean >> $LOG_FILE 2>&1

echo "Removing temporary files older than 7 days..." | tee -a $LOG_FILE
find /tmp -type f -mtime +7 -delete
find /var/tmp -type f -mtime +7 -delete

echo "Truncating large logs..." | tee -a $LOG_FILE

find /var/log -type f -name "*.log" -size +100M | while read logfile
do
    echo "Truncating $logfile" | tee -a $LOG_FILE
    truncate -s 0 "$logfile"
done

echo "Docker Usage After Cleanup" | tee -a $LOG_FILE
docker system df | tee -a $LOG_FILE

echo "Disk Usage After Cleanup" | tee -a $LOG_FILE
df -h | tee -a $LOG_FILE

echo "Memory Usage After Cleanup" | tee -a $LOG_FILE
free -h | tee -a $LOG_FILE

echo "Completed at $(date)" | tee -a $LOG_FILE