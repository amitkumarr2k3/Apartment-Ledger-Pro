import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ETLFileUploadZone } from "@/components/file-upload-zone";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Upload,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/admin/etl")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · ETL Integration" }] }),
});

function Page() {
  const queryClient = useQueryClient();
  const [uploadedFiles, setUploadedFiles] = useState<{ file: File; kind: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch ETL sessions
  const { data: sessionsData, isLoading: isLoadingSessions } = useQuery({
    queryKey: ["etl-sessions"],
    queryFn: async () => {
      const res = await fetch("/api/admin/etl/sessions", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json();
    },
    refetchInterval: 5000, // Auto-refresh every 5s
  });

  // ETL upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (uploadedFiles.length === 0) {
        throw new Error("Please select at least one file");
      }

      const formData = new FormData();
      for (const { file, kind } of uploadedFiles) {
        formData.append(kind, file);
      }

      const res = await fetch("/api/admin/etl/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Upload failed");
      }

      return res.json();
    },
    onSuccess: (data) => {
      toast.success("ETL process completed successfully!");
      console.log("Upload result:", data);
      setUploadedFiles([]);
      queryClient.invalidateQueries({ queryKey: ["etl-sessions"] });
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      console.error("Upload error:", error);
    },
  });

  const handleFileUpload = async () => {
    if (uploadedFiles.length === 0) {
      toast.error("Please select at least one file");
      return;
    }

    setIsUploading(true);
    try {
      await uploadMutation.mutateAsync();
    } finally {
      setIsUploading(false);
    }
  };

  const sessions = sessionsData?.sessions ?? [];

  return (
    <PortalShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">ETL Integration</h1>
          <p className="text-muted-foreground">Upload and process expense, receipt, and vendor files</p>
        </div>

        {/* Info Alert */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Automated ETL Processing</AlertTitle>
          <AlertDescription>
            Upload your expense analysis, receipt analysis, and vendor list files. The system will
            automatically transform them according to your configuration and import the results.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="upload" className="space-y-4">
          <TabsList>
            <TabsTrigger value="upload">Upload Files</TabsTrigger>
            <TabsTrigger value="history">Processing History</TabsTrigger>
          </TabsList>

          {/* Upload Tab */}
          <TabsContent value="upload" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Upload ETL Files</CardTitle>
                <CardDescription>
                  Select files for each type: Expense Analysis, Receipt Analysis, and Vendor List
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ETLFileUploadZone
                  onFilesSelected={setUploadedFiles}
                  disabled={isUploading || uploadMutation.isPending}
                />

                {uploadedFiles.length > 0 && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-900">
                      <strong>{uploadedFiles.length}</strong> file(s) ready to process
                    </p>
                  </div>
                )}

                <Button
                  onClick={handleFileUpload}
                  disabled={
                    uploadedFiles.length === 0 ||
                    isUploading ||
                    uploadMutation.isPending
                  }
                  className="w-full"
                  size="lg"
                >
                  {isUploading || uploadMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Start ETL Process
                    </>
                  )}
                </Button>

                {uploadMutation.data && (
                  <Card className="border-emerald-200 bg-emerald-50">
                    <CardHeader>
                      <CardTitle className="text-emerald-900 text-base">
                        <CheckCircle2 className="inline mr-2 h-4 w-4" />
                        ETL Process Successful
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-emerald-900">
                      <p>
                        <strong>Transactions Imported:</strong> {uploadMutation.data.stats?.transactionsImported || 0}
                      </p>
                      <p>
                        <strong>Failed Rows:</strong> {uploadMutation.data.stats?.transactionsFailed || 0}
                      </p>
                      <p>
                        <strong>Session ID:</strong>{" "}
                        <code className="text-xs bg-white px-2 py-1 rounded">
                          {uploadMutation.data.sessionId}
                        </code>
                      </p>
                    </CardContent>
                  </Card>
                )}

                {uploadMutation.isError && (
                  <Card className="border-red-200 bg-red-50">
                    <CardHeader>
                      <CardTitle className="text-red-900 text-base">
                        <AlertCircle className="inline mr-2 h-4 w-4" />
                        Upload Failed
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-red-900">
                      <p>{uploadMutation.error?.message}</p>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Processing History</CardTitle>
                <CardDescription>Recent ETL processing sessions</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingSessions ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No processing sessions yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Session ID</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Input Files</TableHead>
                          <TableHead>Processed</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sessions.map((session: any) => (
                          <TableRow key={session.id}>
                            <TableCell>
                              <code className="text-xs bg-muted px-2 py-1 rounded">
                                {session.session_id?.substring(0, 8)}...
                              </code>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={session.status} />
                            </TableCell>
                            <TableCell>
                              {Array.isArray(session.input_files) &&
                                session.input_files.length}
                            </TableCell>
                            <TableCell>
                              {formatDistanceToNow(new Date(session.created_at), {
                                addSuffix: true,
                              })}
                            </TableCell>
                            <TableCell>
                              {session.error_message ? (
                                <span className="text-xs text-red-600">
                                  {session.error_message.substring(0, 50)}...
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Configuration Info */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>ETL mapping and transformation settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-medium text-sm mb-2">ETL Pipeline Steps</h4>
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-bold text-foreground">1.</span>
                  Files uploaded to processing queue
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-foreground">2.</span>
                  Python transform script processes files with mapping.yaml
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-foreground">3.</span>
                  Input files moved to processed folder
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-foreground">4.</span>
                  Transformed CSV generated in output folder
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-foreground">5.</span>
                  Transactions automatically imported into database
                </li>
              </ol>
            </div>

            <div>
              <h4 className="font-medium text-sm mb-2">Supported File Types</h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="font-medium">Expense Files</p>
                  <p className="text-muted-foreground">Expense analysis sheets</p>
                </div>
                <div>
                  <p className="font-medium">Receipt Files</p>
                  <p className="text-muted-foreground">Receipt analysis sheets</p>
                </div>
                <div>
                  <p className="font-medium">Vendor Files</p>
                  <p className="text-muted-foreground">Vendor list data</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    completed: {
      icon: CheckCircle2,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    processing: {
      icon: Clock,
      className: "bg-blue-50 text-blue-700 border-blue-200",
    },
    failed: {
      icon: AlertTriangle,
      className: "bg-red-50 text-red-700 border-red-200",
    },
  };

  const cfg = config[status as keyof typeof config] || config.processing;
  const Icon = cfg.icon;

  return (
    <Badge variant="outline" className={cfg.className}>
      <Icon className="inline h-3 w-3 mr-1" />
      {status}
    </Badge>
  );
}
