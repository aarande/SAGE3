/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { PerformanceMetrics, WorkerPerformanceMetrics } from '../types';

/**
 * Performance monitoring utility for SyncWebview
 * Tracks and analyzes performance metrics from the Web Worker
 */
export class PerformanceMonitor {
  private metrics: WorkerPerformanceMetrics[] = [];
  private readonly maxHistorySize = 100;
  private alertThresholds = {
    highLatency: 200, // ms
    highProcessingDelay: 50, // ms
    highQueueSize: 500,
    highEventDropRate: 0.3, // 30%
  };
  private alertCallbacks: ((alert: PerformanceAlert) => void)[] = [];

  /**
   * Add performance metrics from worker
   */
  public addMetrics(metrics: WorkerPerformanceMetrics): void {
    this.metrics.push({
      ...metrics,
      timestamp: Date.now(),
    } as any);

    // Keep only recent metrics
    if (this.metrics.length > this.maxHistorySize) {
      this.metrics = this.metrics.slice(-this.maxHistorySize);
    }

    // Check for performance alerts
    this.checkAlerts(metrics);
  }

  /**
   * Get current performance summary
   */
  public getPerformanceSummary(): PerformanceSummary {
    if (this.metrics.length === 0) {
      return {
        averageLatency: 0,
        averageProcessingDelay: 0,
        averageQueueSize: 0,
        currentPerformance: 'unknown',
        adaptiveSettings: null,
        recommendations: [],
      };
    }

    const recent = this.metrics.slice(-10); // Last 10 measurements
    const avgLatency = recent.reduce((sum, m) => sum + m.networkLatency, 0) / recent.length;
    const avgProcessingDelay = recent.reduce((sum, m) => sum + m.processingDelay, 0) / recent.length;
    const avgQueueSize = recent.reduce((sum, m) => sum + m.eventQueueSize, 0) / recent.length;
    const currentPerformance = recent[recent.length - 1]?.clientPerformance || 'unknown';
    const adaptiveSettings = recent[recent.length - 1]?.adaptiveSampling || null;

    return {
      averageLatency: Math.round(avgLatency),
      averageProcessingDelay: Math.round(avgProcessingDelay * 100) / 100,
      averageQueueSize: Math.round(avgQueueSize),
      currentPerformance,
      adaptiveSettings,
      recommendations: this.generateRecommendations(avgLatency, avgProcessingDelay, avgQueueSize),
    };
  }

  /**
   * Get performance trend analysis
   */
  public getPerformanceTrend(): PerformanceTrend {
    if (this.metrics.length < 2) {
      return { trend: 'stable', confidence: 0 };
    }

    const recent = this.metrics.slice(-10);
    const older = this.metrics.slice(-20, -10);

    if (older.length === 0) {
      return { trend: 'stable', confidence: 0 };
    }

    const recentAvgLatency = recent.reduce((sum, m) => sum + m.networkLatency, 0) / recent.length;
    const olderAvgLatency = older.reduce((sum, m) => sum + m.networkLatency, 0) / older.length;

    const latencyChange = (recentAvgLatency - olderAvgLatency) / olderAvgLatency;

    let trend: 'improving' | 'degrading' | 'stable';
    let confidence = Math.min(Math.abs(latencyChange) * 2, 1); // 0-1 confidence

    if (latencyChange > 0.1) {
      trend = 'degrading';
    } else if (latencyChange < -0.1) {
      trend = 'improving';
    } else {
      trend = 'stable';
    }

    return { trend, confidence };
  }

  /**
   * Register callback for performance alerts
   */
  public onAlert(callback: (alert: PerformanceAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Remove alert callback
   */
  public offAlert(callback: (alert: PerformanceAlert) => void): void {
    const index = this.alertCallbacks.indexOf(callback);
    if (index !== -1) {
      this.alertCallbacks.splice(index, 1);
    }
  }

  /**
   * Get detailed metrics for debugging
   */
  public getDetailedMetrics(): WorkerPerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * Clear metrics history
   */
  public clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Check for performance alerts
   */
  private checkAlerts(metrics: WorkerPerformanceMetrics): void {
    const alerts: PerformanceAlert[] = [];

    if (metrics.networkLatency > this.alertThresholds.highLatency) {
      alerts.push({
        type: 'high_latency',
        severity: metrics.networkLatency > this.alertThresholds.highLatency * 2 ? 'critical' : 'warning',
        message: `High network latency detected: ${metrics.networkLatency}ms`,
        value: metrics.networkLatency,
        threshold: this.alertThresholds.highLatency,
        timestamp: Date.now(),
      });
    }

    if (metrics.processingDelay > this.alertThresholds.highProcessingDelay) {
      alerts.push({
        type: 'high_processing_delay',
        severity: metrics.processingDelay > this.alertThresholds.highProcessingDelay * 2 ? 'critical' : 'warning',
        message: `High processing delay detected: ${metrics.processingDelay}ms`,
        value: metrics.processingDelay,
        threshold: this.alertThresholds.highProcessingDelay,
        timestamp: Date.now(),
      });
    }

    if (metrics.eventQueueSize > this.alertThresholds.highQueueSize) {
      alerts.push({
        type: 'high_queue_size',
        severity: metrics.eventQueueSize > this.alertThresholds.highQueueSize * 2 ? 'critical' : 'warning',
        message: `High event queue size detected: ${metrics.eventQueueSize} events`,
        value: metrics.eventQueueSize,
        threshold: this.alertThresholds.highQueueSize,
        timestamp: Date.now(),
      });
    }

    if (metrics.adaptiveSampling?.eventDropRate > this.alertThresholds.highEventDropRate) {
      alerts.push({
        type: 'high_event_drop_rate',
        severity: metrics.adaptiveSampling.eventDropRate > this.alertThresholds.highEventDropRate * 2 ? 'critical' : 'warning',
        message: `High event drop rate detected: ${Math.round(metrics.adaptiveSampling.eventDropRate * 100)}%`,
        value: metrics.adaptiveSampling.eventDropRate,
        threshold: this.alertThresholds.highEventDropRate,
        timestamp: Date.now(),
      });
    }

    // Notify alert callbacks
    alerts.forEach(alert => {
      this.alertCallbacks.forEach(callback => callback(alert));
    });
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(
    avgLatency: number,
    avgProcessingDelay: number,
    avgQueueSize: number
  ): string[] {
    const recommendations: string[] = [];

    if (avgLatency > this.alertThresholds.highLatency) {
      recommendations.push('Consider reducing batch size or increasing batch interval to reduce network load');
    }

    if (avgProcessingDelay > this.alertThresholds.highProcessingDelay) {
      recommendations.push('Consider enabling more aggressive event dropping or reducing mouse sampling rate');
    }

    if (avgQueueSize > this.alertThresholds.highQueueSize) {
      recommendations.push('Consider increasing batch frequency or enabling adaptive sampling');
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance is within normal parameters');
    }

    return recommendations;
  }
}

// Type definitions for performance monitoring
export interface PerformanceSummary {
  averageLatency: number;
  averageProcessingDelay: number;
  averageQueueSize: number;
  currentPerformance: 'high' | 'medium' | 'low' | 'unknown';
  adaptiveSettings: any;
  recommendations: string[];
}

export interface PerformanceTrend {
  trend: 'improving' | 'degrading' | 'stable';
  confidence: number; // 0-1
}

export interface PerformanceAlert {
  type: 'high_latency' | 'high_processing_delay' | 'high_queue_size' | 'high_event_drop_rate';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
}