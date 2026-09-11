#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/var/log/housekeeping.log"

echo "========================================" | tee -a "$LOG_FILE"
echo "Housekeeping Started: $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

echo "Disk Usage Before Cleanup" | tee -a "$LOG_FILE"
df -h | tee -a "$LOG_FILE"

echo "Memory Usage Before Cleanup" | tee -a "$LOG_FILE"
free -h | tee -a "$LOG_FILE"

echo "Removing stopped / unnecessary containers..." | tee -a "$LOG_FILE"
docker container prune -f 2>&1 | tee -a "$LOG_FILE"

echo "Removing unused / dangling Docker images..." | tee -a "$LOG_FILE"
docker image prune -af 2>&1 | tee -a "$LOG_FILE"

echo "Cleaning Docker Build Cache..." | tee -a "$LOG_FILE"
docker builder prune -af 2>&1 | tee -a "$LOG_FILE"

echo "Removing unused Docker networks..." | tee -a "$LOG_FILE"
docker network prune -f 2>&1 | tee -a "$LOG_FILE"

echo "Removing dangling volumes..." | tee -a "$LOG_FILE"
docker volume prune -f 2>&1 | tee -a "$LOG_FILE"

echo "Cleaning apt cache..." | tee -a "$LOG_FILE"
apt-get clean 2>&1 | tee -a "$LOG_FILE"

echo "Removing temporary files older than 7 days..." | tee -a "$LOG_FILE"
find /tmp -type f -mtime +7 -delete
find /var/tmp -type f -mtime +7 -delete

echo "Docker Usage After Cleanup" | tee -a "$LOG_FILE"
docker system df | tee -a "$LOG_FILE"

echo "Disk Usage After Cleanup" | tee -a "$LOG_FILE"
df -h | tee -a "$LOG_FILE"

echo "Memory Usage After Cleanup" | tee -a "$LOG_FILE"
free -h | tee -a "$LOG_FILE"

echo "Completed at $(date)" | tee -a "$LOG_FILE"