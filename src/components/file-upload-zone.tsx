import { useState, useRef } from "react";
import { Upload, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface FileUploadZoneProps {
  accept?: string;
  maxSize?: number;
  onFilesSelected: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  description?: string;
}

interface FileItem {
  file: File;
  id: string;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

export function FileUploadZone({
  accept = ".csv,.xlsx,.xls",
  maxSize = 10 * 1024 * 1024, // 10MB
  onFilesSelected,
  multiple = true,
  disabled = false,
  className,
  description,
}: FileUploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFiles(droppedFiles);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = (newFiles: File[]) => {
    if (disabled) return;

    const validFiles = newFiles.filter((file) => {
      // Check file size
      if (file.size > maxSize) {
        toast.error(`${file.name} exceeds max size of ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
        return false;
      }
      return true;
    });

    if (!multiple && validFiles.length > 0) {
      // Replace with single file
      const fileItem: FileItem = {
        file: validFiles[0],
        id: Math.random().toString(),
        progress: 0,
        status: "pending",
      };
      setFiles([fileItem]);
    } else if (multiple) {
      // Add to existing files
      const newItems = validFiles.map((file) => ({
        file,
        id: Math.random().toString(),
        progress: 0,
        status: "pending" as const,
      }));
      setFiles((prev) => [...prev, ...newItems]);
    }

    onFilesSelected(validFiles);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const removeAllFiles = () => {
    setFiles([]);
  };

  return (
    <div className={className}>
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-lg border-2 border-dashed transition-colors p-8 text-center cursor-pointer",
          dragActive
            ? "border-primary/50 bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/30 hover:bg-primary/2",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          onChange={handleChange}
          disabled={disabled}
          className="hidden"
        />

        <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium">
          {disabled ? "Upload disabled" : "Click to upload or drag and drop"}
        </p>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        <p className="text-xs text-muted-foreground mt-2">
          {accept === ".csv,.xlsx,.xls" ? "CSV, XLS, XLSX" : accept}
        </p>
        <p className="text-xs text-muted-foreground">
          Max size: {(maxSize / 1024 / 1024).toFixed(0)}MB
        </p>
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((item) => (
            <Card key={item.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {item.status === "success" && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  )}
                  {item.status === "error" && (
                    <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                  )}
                  {item.status === "uploading" && (
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
                  )}
                  {item.status === "pending" && (
                    <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/25 flex-shrink-0" />
                  )}

                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.file.name}</p>
                    {item.error && <p className="text-xs text-red-500">{item.error}</p>}
                    <p className="text-xs text-muted-foreground">
                      {(item.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => removeFile(item.id)}
                  className="ml-2 rounded-lg p-1 hover:bg-muted flex-shrink-0"
                  disabled={item.status === "uploading"}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {item.status === "uploading" && (
                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}
            </Card>
          ))}

          {files.some((f) => f.status !== "uploading") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={removeAllFiles}
              className="w-full text-xs"
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Specialized component for ETL file uploads
 * Handles expense, receipt, and vendor files
 */
export function ETLFileUploadZone({
  onFilesSelected,
  disabled = false,
}: {
  onFilesSelected: (files: { file: File; kind: string }[]) => void;
  disabled?: boolean;
}) {
  const [files, setFiles] = useState<{ file: File; kind: string; id: string }[]>([]);
  const [selectedKind, setSelectedKind] = useState<"expense" | "receipt" | "vendor" | null>(null);

  const handleFileSelected = (selectedFiles: File[]) => {
    if (!selectedKind || selectedFiles.length === 0) {
      toast.error("Please select a file type first");
      return;
    }

    const newFiles = selectedFiles.map((file) => ({
      file,
      kind: selectedKind,
      id: `${selectedKind}_${Math.random()}`,
    }));

    setFiles((prev) => [...prev, ...newFiles]);
    onFilesSelected([...files, ...newFiles]);
    setSelectedKind(null);
  };

  const removeFile = (id: string) => {
    const newFiles = files.filter((f) => f.id !== id);
    setFiles(newFiles);
    onFilesSelected(newFiles);
  };

  const getFileIcon = (kind: string) => {
    const icons: Record<string, React.ReactNode> = {
      expense: "📊",
      receipt: "📄",
      vendor: "🏢",
    };
    return icons[kind] ?? "📁";
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {(["expense", "receipt", "vendor"] as const).map((kind) => (
          <Button
            key={kind}
            variant={selectedKind === kind ? "default" : "outline"}
            className="capitalize"
            onClick={() => setSelectedKind(kind)}
            disabled={disabled}
          >
            {kind}
          </Button>
        ))}
      </div>

      {selectedKind && (
        <FileUploadZone
          accept=".csv,.xlsx,.xls"
          multiple={false}
          onFilesSelected={handleFileSelected}
          disabled={disabled}
          description={`Upload ${selectedKind} file (CSV or Excel)`}
        />
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Files to upload:</h4>
          {files.map((item) => (
            <Card key={item.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg">{getFileIcon(item.kind)}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      Type: {item.kind}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => removeFile(item.id)}
                  className="ml-2 rounded-lg p-1 hover:bg-muted flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
