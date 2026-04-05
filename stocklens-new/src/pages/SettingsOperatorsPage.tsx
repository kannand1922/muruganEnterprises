import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonPage,
  IonTextarea,
  IonText,
  IonToggle,
  useIonToast,
} from "@ionic/react";
import { type ChangeEvent, useEffect, useState } from "react";
import { createOutline, eyeOutline, trashOutline } from "ionicons/icons";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  createWorker,
  deleteWorker,
  getWorkers,
  updateWorker,
  type Worker,
  type WorkerPayload,
} from "../api/metaApi";

type UploadedAsset = {
  base64: string;
  mimeType: string;
  fileName: string;
};

type PhoneNumberFormRow = {
  id: string;
  label: string;
  phoneNumber: string;
  isPrimary: boolean;
};

type DocumentFormRow = {
  id: string;
  category: "otherProof" | "additionalDetail";
  label: string;
  textValue: string;
  fileName: string;
  mimeType: string;
  fileDataBase64: string;
};

type WorkerForm = {
  name: string;
  fatherName: string;
  designationName: string;
  dateOfBirth: string;
  dateOfJoining: string;
  dateOfResignation: string;
  permanentAddress: string;
  temporaryAddress: string;
  aadhaarNumber: string;
  email: string;
  bankAccountNumber: string;
  ifscCode: string;
  recommendedBy: string;
  workLocationName: string;
  profileImage: UploadedAsset | null;
  resumeFile: UploadedAsset | null;
  aadhaarImage: UploadedAsset | null;
  phoneNumbers: PhoneNumberFormRow[];
  otherProofs: DocumentFormRow[];
  additionalDetails: DocumentFormRow[];
  active: boolean;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPhoneRow(overrides: Partial<PhoneNumberFormRow> = {}): PhoneNumberFormRow {
  return {
    id: createId("phone"),
    label: "",
    phoneNumber: "",
    isPrimary: false,
    ...overrides,
  };
}

function createDocumentRow(
  category: "otherProof" | "additionalDetail",
  overrides: Partial<DocumentFormRow> = {}
): DocumentFormRow {
  return {
    id: createId(category),
    category,
    label: "",
    textValue: "",
    fileName: "",
    mimeType: "",
    fileDataBase64: "",
    ...overrides,
  };
}

const EMPTY_FORM: WorkerForm = {
  name: "",
  fatherName: "",
  designationName: "",
  dateOfBirth: "",
  dateOfJoining: "",
  dateOfResignation: "",
  permanentAddress: "",
  temporaryAddress: "",
  aadhaarNumber: "",
  email: "",
  bankAccountNumber: "",
  ifscCode: "",
  recommendedBy: "Direct",
  workLocationName: "",
  profileImage: null,
  resumeFile: null,
  aadhaarImage: null,
  phoneNumbers: [createPhoneRow({ label: "Primary", isPrimary: true })],
  otherProofs: [createDocumentRow("otherProof")],
  additionalDetails: [createDocumentRow("additionalDetail")],
  active: true,
};

function toDateInputValue(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function fileToAsset(file: File): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      const base64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      resolve({
        base64,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name,
      });
    };
    reader.readAsDataURL(file);
  });
}

function assetToDataUrl(asset: UploadedAsset | null) {
  if (!asset?.base64) return "";
  return `data:${asset.mimeType || "application/octet-stream"};base64,${asset.base64}`;
}

function fileDataToUrl(base64?: string | null, mimeType?: string | null) {
  if (!base64) return "";
  return `data:${mimeType || "application/octet-stream"};base64,${base64}`;
}

function normalizeWorkerToForm(row: Worker): WorkerForm {
  return {
    name: row.name || "",
    fatherName: row.fatherName || "",
    designationName: row.designationName || "",
    dateOfBirth: toDateInputValue(row.dateOfBirth),
    dateOfJoining: toDateInputValue(row.dateOfJoining),
    dateOfResignation: toDateInputValue(row.dateOfResignation),
    permanentAddress: row.permanentAddress || "",
    temporaryAddress: row.temporaryAddress || "",
    aadhaarNumber: row.aadhaarNumber || "",
    email: row.email || "",
    bankAccountNumber: row.bankAccountNumber || "",
    ifscCode: row.ifscCode || "",
    recommendedBy: row.recommendedBy || "Direct",
    workLocationName: row.workLocationName || "",
    profileImage: row.profileImageBase64
      ? {
          base64: row.profileImageBase64,
          mimeType: row.profileImageMimeType || "image/jpeg",
          fileName: row.profileImageFileName || "profile-image",
        }
      : null,
    resumeFile: row.resumeFileBase64
      ? {
          base64: row.resumeFileBase64,
          mimeType: row.resumeFileMimeType || "application/octet-stream",
          fileName: row.resumeFileName || "resume",
        }
      : null,
    aadhaarImage: row.aadhaarImageBase64
      ? {
          base64: row.aadhaarImageBase64,
          mimeType: row.aadhaarImageMimeType || "image/jpeg",
          fileName: row.aadhaarImageFileName || "aadhaar-image",
        }
      : null,
    phoneNumbers:
      row.phoneNumbers?.length
        ? row.phoneNumbers.map((phoneRow, index) =>
            createPhoneRow({
              label: phoneRow.label || "",
              phoneNumber: phoneRow.phoneNumber || "",
              isPrimary: index === 0 ? true : Boolean(phoneRow.isPrimary),
            })
          )
        : [createPhoneRow({ label: "Primary", phoneNumber: row.phone || "", isPrimary: true })],
    otherProofs:
      row.documents?.filter((documentRow) => documentRow.category === "otherProof").length
        ? row.documents
            .filter((documentRow) => documentRow.category === "otherProof")
            .map((documentRow) =>
              createDocumentRow("otherProof", {
                label: documentRow.label || "",
                textValue: documentRow.textValue || "",
                fileName: documentRow.fileName || "",
                mimeType: documentRow.mimeType || "",
                fileDataBase64: documentRow.fileDataBase64 || "",
              })
            )
        : [createDocumentRow("otherProof")],
    additionalDetails:
      row.documents?.filter((documentRow) => documentRow.category === "additionalDetail").length
        ? row.documents
            .filter((documentRow) => documentRow.category === "additionalDetail")
            .map((documentRow) =>
              createDocumentRow("additionalDetail", {
                label: documentRow.label || "",
                textValue: documentRow.textValue || "",
                fileName: documentRow.fileName || "",
                mimeType: documentRow.mimeType || "",
                fileDataBase64: documentRow.fileDataBase64 || "",
              })
            )
        : [createDocumentRow("additionalDetail")],
    active: row.active,
  };
}

function validateForm(form: WorkerForm) {
  const validPhones = form.phoneNumbers.filter((row) => row.phoneNumber.trim());
  if (!form.profileImage?.base64) return "Profile image is required";
  if (!form.name.trim()) return "Name is required";
  if (!form.fatherName.trim()) return "Father's name is required";
  if (!form.designationName.trim()) return "Designation is required";
  if (!form.dateOfBirth) return "Date of birth is required";
  if (!form.dateOfJoining) return "Date of joining is required";
  if (!form.resumeFile?.base64) return "Resume file is required";
  if (!form.permanentAddress.trim()) return "Permanent address is required";
  if (!form.aadhaarNumber.trim()) return "Aadhaar number is required";
  if (!form.aadhaarImage?.base64) return "Aadhaar image is required";
  if (!validPhones.length) return "At least one phone number is required";
  if (!form.bankAccountNumber.trim()) return "Bank account number is required";
  if (!form.ifscCode.trim()) return "IFSC code is required";
  if (!form.recommendedBy.trim()) return "Recommended by is required";
  return null;
}

function buildPayload(form: WorkerForm): WorkerPayload {
  const phoneNumbers = form.phoneNumbers
    .filter((row) => row.phoneNumber.trim())
    .map((row, index) => ({
      label: row.label.trim() || null,
      phoneNumber: row.phoneNumber.trim(),
      isPrimary: index === 0 ? true : Boolean(row.isPrimary),
    }));

  const otherProofs = form.otherProofs
    .filter((row) => row.label.trim() || row.textValue.trim() || row.fileDataBase64)
    .map((row, index) => ({
      category: "otherProof",
      label: row.label.trim() || null,
      textValue: row.textValue.trim() || null,
      fileName: row.fileName || null,
      mimeType: row.mimeType || null,
      fileDataBase64: row.fileDataBase64 || null,
      sortOrder: index,
      active: true,
    }));

  const additionalDetails = form.additionalDetails
    .filter((row) => row.label.trim() || row.textValue.trim() || row.fileDataBase64)
    .map((row, index) => ({
      category: "additionalDetail",
      label: row.label.trim() || null,
      textValue: row.textValue.trim() || null,
      fileName: row.fileName || null,
      mimeType: row.mimeType || null,
      fileDataBase64: row.fileDataBase64 || null,
      sortOrder: index,
      active: true,
    }));

  return {
    name: form.name.trim(),
    fatherName: form.fatherName.trim(),
    designationName: form.designationName.trim(),
    dateOfBirth: form.dateOfBirth,
    dateOfJoining: form.dateOfJoining,
    dateOfResignation: form.dateOfResignation || null,
    permanentAddress: form.permanentAddress.trim(),
    temporaryAddress: form.temporaryAddress.trim() || null,
    aadhaarNumber: form.aadhaarNumber.trim(),
    email: form.email.trim() || null,
    bankAccountNumber: form.bankAccountNumber.trim(),
    ifscCode: form.ifscCode.trim(),
    recommendedBy: form.recommendedBy.trim() || "Direct",
    workLocationName: form.workLocationName.trim() || null,
    profileImageBase64: form.profileImage?.base64 || "",
    profileImageMimeType: form.profileImage?.mimeType || null,
    profileImageFileName: form.profileImage?.fileName || null,
    resumeFileBase64: form.resumeFile?.base64 || "",
    resumeFileMimeType: form.resumeFile?.mimeType || null,
    resumeFileName: form.resumeFile?.fileName || null,
    aadhaarImageBase64: form.aadhaarImage?.base64 || "",
    aadhaarImageMimeType: form.aadhaarImage?.mimeType || null,
    aadhaarImageFileName: form.aadhaarImage?.fileName || null,
    phoneNumbers,
    documents: [...otherProofs, ...additionalDetails],
    active: form.active,
  };
}

export function SettingsOperatorsPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingWorker, setViewingWorker] = useState<Worker | null>(null);
  const [rows, setRows] = useState<Worker[]>([]);
  const [form, setForm] = useState<WorkerForm>(EMPTY_FORM);

  async function loadRows() {
    setLoading(true);
    try {
      const list = await getWorkers();
      setRows(list);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load operators",
        color: "danger",
        duration: 2000,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      phoneNumbers: [createPhoneRow({ label: "Primary", isPrimary: true })],
      otherProofs: [createDocumentRow("otherProof")],
      additionalDetails: [createDocumentRow("additionalDetail")],
    });
  }

  function startEdit(row: Worker) {
    setEditingId(row.id);
    setForm(normalizeWorkerToForm(row));
  }

  async function handleAssetSelect(
    event: ChangeEvent<HTMLInputElement>,
    target: "profileImage" | "resumeFile" | "aadhaarImage"
  ) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const asset = await fileToAsset(file);
      setForm((current) => ({ ...current, [target]: asset }));
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to read file",
        color: "danger",
        duration: 1800,
      });
    } finally {
      input.value = "";
    }
  }

  async function handleDocumentFileSelect(event: ChangeEvent<HTMLInputElement>, id: string) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const asset = await fileToAsset(file);
      const apply = (rowsToEdit: DocumentFormRow[]) =>
        rowsToEdit.map((row) =>
          row.id === id
            ? {
                ...row,
                fileName: asset.fileName,
                mimeType: asset.mimeType,
                fileDataBase64: asset.base64,
              }
            : row
        );
      setForm((current) => ({
        ...current,
        otherProofs: apply(current.otherProofs),
        additionalDetails: apply(current.additionalDetails),
      }));
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to read file",
        color: "danger",
        duration: 1800,
      });
    } finally {
      input.value = "";
    }
  }

  async function onSave() {
    const validationError = validateForm(form);
    if (validationError) {
      presentToast({ message: validationError, color: "warning", duration: 1800 });
      return;
    }

    const payload = buildPayload(form);
    setSaving(true);
    try {
      if (editingId) {
        await updateWorker(editingId, payload);
        presentToast({ message: "Operator updated", color: "success", duration: 1500 });
      } else {
        await createWorker(payload);
        presentToast({ message: "Operator created", color: "success", duration: 1500 });
      }
      resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save operator",
        color: "danger",
        duration: 2200,
      });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await deleteWorker(id);
      presentToast({ message: "Operator removed", color: "success", duration: 1500 });
      if (editingId === id) resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to delete operator",
        color: "danger",
        duration: 1800,
      });
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Operators" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding">
        {loading ? <IonNote>Loading...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Operators List</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {rows.length === 0 ? (
              <IonText color="medium">No operators found.</IonText>
            ) : (
              <IonList className="operator-list">
                {rows.map((row) => (
                  <IonItem key={row.id} className="operator-list-item">
                    <IonLabel className="operator-list-name">
                      <h2>{row.name}</h2>
                    </IonLabel>
                    <div className="settings-row-actions operator-list-actions">
                      <IonButton
                        size="small"
                        fill="clear"
                        aria-label={`Edit ${row.name}`}
                        onClick={() => startEdit(row)}
                      >
                        <IonIcon icon={createOutline} />
                      </IonButton>
                      <IonButton
                        size="small"
                        fill="clear"
                        aria-label={`View ${row.name}`}
                        onClick={() => setViewingWorker(row)}
                      >
                        <IonIcon icon={eyeOutline} />
                      </IonButton>
                      <IonButton
                        size="small"
                        color="danger"
                        fill="clear"
                        aria-label={`Delete ${row.name}`}
                        onClick={() => onDelete(row.id)}
                      >
                        <IonIcon icon={trashOutline} />
                      </IonButton>
                    </div>
                  </IonItem>
                ))}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>{editingId ? "Update Operator Profile" : "Create Operator Profile"}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent className="operator-profile-form">
            <div className="operator-form-section">
              <h3>Profile</h3>
              <IonItem>
                <IonLabel position="stacked">Name</IonLabel>
                <IonInput value={form.name} onIonInput={(e) => setForm((s) => ({ ...s, name: e.detail.value || "" }))} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Father's Name</IonLabel>
                <IonInput
                  value={form.fatherName}
                  onIonInput={(e) => setForm((s) => ({ ...s, fatherName: e.detail.value || "" }))}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Designation</IonLabel>
                <IonInput
                  value={form.designationName}
                  onIonInput={(e) => setForm((s) => ({ ...s, designationName: e.detail.value || "" }))}
                  placeholder="Type a designation"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Work Location</IonLabel>
                <IonInput
                  value={form.workLocationName}
                  onIonInput={(e) => setForm((s) => ({ ...s, workLocationName: e.detail.value || "" }))}
                  placeholder="Optional"
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Recommended By</IonLabel>
                <IonInput
                  value={form.recommendedBy}
                  onIonInput={(e) => setForm((s) => ({ ...s, recommendedBy: e.detail.value || "" }))}
                />
              </IonItem>
              {editingId ? (
                <IonItem>
                  <IonLabel>Active</IonLabel>
                  <IonToggle
                    checked={form.active}
                    onIonChange={(e) => setForm((s) => ({ ...s, active: e.detail.checked }))}
                  />
                </IonItem>
              ) : null}
              <div className="operator-upload-card">
                <IonText>
                  <h4>Profile Image</h4>
                </IonText>
                {form.profileImage ? (
                  <img className="operator-image-preview" src={assetToDataUrl(form.profileImage)} alt="Profile preview" />
                ) : (
                  <IonNote color="medium">No profile image selected</IonNote>
                )}
                <div className="operator-upload-actions">
                  <label className="operator-upload-button">
                    Use Camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      onChange={(event) => void handleAssetSelect(event, "profileImage")}
                    />
                  </label>
                  <label className="operator-upload-button operator-upload-button-secondary">
                    Upload from Gallery
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => void handleAssetSelect(event, "profileImage")}
                    />
                  </label>
                </div>
                {form.profileImage?.fileName ? <IonNote>{form.profileImage.fileName}</IonNote> : null}
              </div>
            </div>

            <div className="operator-form-section">
              <h3>Employment & Contact</h3>
              <IonItem>
                <IonLabel position="stacked">Date of Birth</IonLabel>
                <IonInput
                  type="date"
                  value={form.dateOfBirth}
                  onIonInput={(e) => setForm((s) => ({ ...s, dateOfBirth: e.detail.value || "" }))}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Date of Joining</IonLabel>
                <IonInput
                  type="date"
                  value={form.dateOfJoining}
                  onIonInput={(e) => setForm((s) => ({ ...s, dateOfJoining: e.detail.value || "" }))}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Date of Resignation</IonLabel>
                <IonInput
                  type="date"
                  value={form.dateOfResignation}
                  onIonInput={(e) => setForm((s) => ({ ...s, dateOfResignation: e.detail.value || "" }))}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Email ID</IonLabel>
                <IonInput value={form.email} onIonInput={(e) => setForm((s) => ({ ...s, email: e.detail.value || "" }))} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Permanent Address</IonLabel>
                <IonTextarea
                  value={form.permanentAddress}
                  onIonInput={(e) => setForm((s) => ({ ...s, permanentAddress: e.detail.value || "" }))}
                  autoGrow
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Temporary Address</IonLabel>
                <IonTextarea
                  value={form.temporaryAddress}
                  onIonInput={(e) => setForm((s) => ({ ...s, temporaryAddress: e.detail.value || "" }))}
                  autoGrow
                />
              </IonItem>
              <div className="operator-repeatable-block">
                <div className="operator-repeatable-header">
                  <h4>Phone Numbers</h4>
                  <IonButton size="small" fill="outline" onClick={() => setForm((s) => ({
                    ...s,
                    phoneNumbers: [...s.phoneNumbers, createPhoneRow()],
                  }))}>
                    Add Phone
                  </IonButton>
                </div>
                {form.phoneNumbers.map((row, index) => (
                  <div key={row.id} className="operator-repeatable-item">
                    <IonItem>
                      <IonLabel position="stacked">Label</IonLabel>
                      <IonInput
                        value={row.label}
                        onIonInput={(e) =>
                          setForm((s) => ({
                            ...s,
                            phoneNumbers: s.phoneNumbers.map((phoneRow) =>
                              phoneRow.id === row.id ? { ...phoneRow, label: e.detail.value || "" } : phoneRow
                            ),
                          }))
                        }
                        placeholder="Primary / Secondary"
                      />
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">Phone Number</IonLabel>
                      <IonInput
                        value={row.phoneNumber}
                        onIonInput={(e) =>
                          setForm((s) => ({
                            ...s,
                            phoneNumbers: s.phoneNumbers.map((phoneRow) =>
                              phoneRow.id === row.id ? { ...phoneRow, phoneNumber: e.detail.value || "" } : phoneRow
                            ),
                          }))
                        }
                      />
                    </IonItem>
                    <div className="operator-inline-actions">
                      <IonButton
                        size="small"
                        fill={row.isPrimary ? "solid" : "outline"}
                        onClick={() =>
                          setForm((s) => ({
                            ...s,
                            phoneNumbers: s.phoneNumbers.map((phoneRow) => ({
                              ...phoneRow,
                              isPrimary: phoneRow.id === row.id,
                            })),
                          }))
                        }
                      >
                        {row.isPrimary ? "Primary" : "Set Primary"}
                      </IonButton>
                      {form.phoneNumbers.length > 1 ? (
                        <IonButton
                          size="small"
                          color="danger"
                          fill="outline"
                          onClick={() =>
                            setForm((s) => ({
                              ...s,
                              phoneNumbers: s.phoneNumbers.filter((phoneRow) => phoneRow.id !== row.id).map((phoneRow, itemIndex) => ({
                                ...phoneRow,
                                isPrimary: itemIndex === 0 ? true : phoneRow.isPrimary && itemIndex === 0,
                              })),
                            }))
                          }
                        >
                          Remove
                        </IonButton>
                      ) : null}
                    </div>
                    {index < form.phoneNumbers.length - 1 ? <div className="operator-divider" /> : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="operator-form-section">
              <h3>Identity & Bank</h3>
              <IonItem>
                <IonLabel position="stacked">Aadhaar Number</IonLabel>
                <IonInput
                  value={form.aadhaarNumber}
                  onIonInput={(e) => setForm((s) => ({ ...s, aadhaarNumber: e.detail.value || "" }))}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Bank Account Number</IonLabel>
                <IonInput
                  value={form.bankAccountNumber}
                  onIonInput={(e) => setForm((s) => ({ ...s, bankAccountNumber: e.detail.value || "" }))}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">IFSC Code</IonLabel>
                <IonInput value={form.ifscCode} onIonInput={(e) => setForm((s) => ({ ...s, ifscCode: e.detail.value || "" }))} />
              </IonItem>

              <div className="operator-upload-card">
                <IonText>
                  <h4>Resume File</h4>
                </IonText>
                <div className="operator-upload-actions">
                  <label className="operator-upload-button operator-upload-button-secondary">
                    Upload Resume
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,image/*"
                      hidden
                      onChange={(event) => void handleAssetSelect(event, "resumeFile")}
                    />
                  </label>
                </div>
                {form.resumeFile?.fileName ? <IonNote>{form.resumeFile.fileName}</IonNote> : <IonNote color="medium">No resume selected</IonNote>}
              </div>

              <div className="operator-upload-card">
                <IonText>
                  <h4>Aadhaar Image</h4>
                </IonText>
                {form.aadhaarImage ? (
                  <img className="operator-image-preview" src={assetToDataUrl(form.aadhaarImage)} alt="Aadhaar preview" />
                ) : (
                  <IonNote color="medium">No Aadhaar image selected</IonNote>
                )}
                <div className="operator-upload-actions">
                  <label className="operator-upload-button">
                    Use Camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      onChange={(event) => void handleAssetSelect(event, "aadhaarImage")}
                    />
                  </label>
                  <label className="operator-upload-button operator-upload-button-secondary">
                    Upload from Gallery
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => void handleAssetSelect(event, "aadhaarImage")}
                    />
                  </label>
                </div>
                {form.aadhaarImage?.fileName ? <IonNote>{form.aadhaarImage.fileName}</IonNote> : null}
              </div>
            </div>

            <div className="operator-form-section">
              <h3>Other Proofs</h3>
              <div className="operator-repeatable-header">
                <IonNote color="medium">Optional files and supporting text</IonNote>
                <IonButton
                  size="small"
                  fill="outline"
                  onClick={() => setForm((s) => ({ ...s, otherProofs: [...s.otherProofs, createDocumentRow("otherProof")] }))}
                >
                  Add Proof
                </IonButton>
              </div>
              {form.otherProofs.map((row) => (
                <div key={row.id} className="operator-repeatable-item">
                  <IonItem>
                    <IonLabel position="stacked">Label</IonLabel>
                    <IonInput
                      value={row.label}
                      onIonInput={(e) =>
                        setForm((s) => ({
                          ...s,
                          otherProofs: s.otherProofs.map((item) =>
                            item.id === row.id ? { ...item, label: e.detail.value || "" } : item
                          ),
                        }))
                      }
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">Text</IonLabel>
                    <IonTextarea
                      value={row.textValue}
                      onIonInput={(e) =>
                        setForm((s) => ({
                          ...s,
                          otherProofs: s.otherProofs.map((item) =>
                            item.id === row.id ? { ...item, textValue: e.detail.value || "" } : item
                          ),
                        }))
                      }
                      autoGrow
                    />
                  </IonItem>
                  <div className="operator-upload-actions">
                    <label className="operator-upload-button operator-upload-button-secondary">
                      Upload File
                      <input type="file" hidden onChange={(event) => void handleDocumentFileSelect(event, row.id)} />
                    </label>
                    {form.otherProofs.length > 1 ? (
                      <IonButton
                        size="small"
                        color="danger"
                        fill="outline"
                        onClick={() =>
                          setForm((s) => ({ ...s, otherProofs: s.otherProofs.filter((item) => item.id !== row.id) }))
                        }
                      >
                        Remove
                      </IonButton>
                    ) : null}
                  </div>
                  {row.fileName ? <IonNote>{row.fileName}</IonNote> : null}
                </div>
              ))}
            </div>

            <div className="operator-form-section">
              <h3>Additional Details</h3>
              <div className="operator-repeatable-header">
                <IonNote color="medium">Optional notes with or without files</IonNote>
                <IonButton
                  size="small"
                  fill="outline"
                  onClick={() =>
                    setForm((s) => ({
                      ...s,
                      additionalDetails: [...s.additionalDetails, createDocumentRow("additionalDetail")],
                    }))
                  }
                >
                  Add Detail
                </IonButton>
              </div>
              {form.additionalDetails.map((row) => (
                <div key={row.id} className="operator-repeatable-item">
                  <IonItem>
                    <IonLabel position="stacked">Label</IonLabel>
                    <IonInput
                      value={row.label}
                      onIonInput={(e) =>
                        setForm((s) => ({
                          ...s,
                          additionalDetails: s.additionalDetails.map((item) =>
                            item.id === row.id ? { ...item, label: e.detail.value || "" } : item
                          ),
                        }))
                      }
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">Text</IonLabel>
                    <IonTextarea
                      value={row.textValue}
                      onIonInput={(e) =>
                        setForm((s) => ({
                          ...s,
                          additionalDetails: s.additionalDetails.map((item) =>
                            item.id === row.id ? { ...item, textValue: e.detail.value || "" } : item
                          ),
                        }))
                      }
                      autoGrow
                    />
                  </IonItem>
                  <div className="operator-upload-actions">
                    <label className="operator-upload-button operator-upload-button-secondary">
                      Upload File
                      <input type="file" hidden onChange={(event) => void handleDocumentFileSelect(event, row.id)} />
                    </label>
                    {form.additionalDetails.length > 1 ? (
                      <IonButton
                        size="small"
                        color="danger"
                        fill="outline"
                        onClick={() =>
                          setForm((s) => ({
                            ...s,
                            additionalDetails: s.additionalDetails.filter((item) => item.id !== row.id),
                          }))
                        }
                      >
                        Remove
                      </IonButton>
                    ) : null}
                  </div>
                  {row.fileName ? <IonNote>{row.fileName}</IonNote> : null}
                </div>
              ))}
            </div>

            <div className="settings-actions settings-actions-inline">
              <IonButton onClick={onSave} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update Operator" : "Create Operator"}
              </IonButton>
              <IonButton fill="outline" onClick={resetForm}>
                Clear
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>

        <IonModal
          isOpen={Boolean(viewingWorker)}
          onDidDismiss={() => setViewingWorker(null)}
          className="operator-profile-modal"
        >
          <IonContent fullscreen className="settings-page-content ion-padding operator-profile-modal-content">
            {viewingWorker ? (
              <div className="operator-profile-modal-shell">
                <div className="operator-profile-modal-header">
                  <div className="operator-list-row">
                    {viewingWorker.profileImageBase64 ? (
                      <img
                        className="operator-image-preview"
                        src={fileDataToUrl(viewingWorker.profileImageBase64, viewingWorker.profileImageMimeType)}
                        alt={viewingWorker.name}
                      />
                    ) : (
                      <div className="operator-avatar-fallback">
                        {String(viewingWorker.name || "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h2>{viewingWorker.name}</h2>
                      <p>{viewingWorker.designationName || "-"}</p>
                      <p>{viewingWorker.workLocationName || "No work location"}</p>
                    </div>
                  </div>
                  <IonButton fill="outline" onClick={() => setViewingWorker(null)}>
                    Close
                  </IonButton>
                </div>

                <div className="operator-profile-view-grid">
                  <section className="operator-upload-card">
                    <h3>Basic Info</h3>
                    <p><strong>Father's Name:</strong> {viewingWorker.fatherName || "-"}</p>
                    <p><strong>Recommended By:</strong> {viewingWorker.recommendedBy || "-"}</p>
                    <p><strong>DOB:</strong> {toDateInputValue(viewingWorker.dateOfBirth) || "-"}</p>
                    <p><strong>Joining:</strong> {toDateInputValue(viewingWorker.dateOfJoining) || "-"}</p>
                    <p><strong>Resignation:</strong> {toDateInputValue(viewingWorker.dateOfResignation) || "-"}</p>
                    <p><strong>Email:</strong> {viewingWorker.email || "-"}</p>
                  </section>

                  <section className="operator-upload-card">
                    <h3>Addresses</h3>
                    <p><strong>Permanent:</strong> {viewingWorker.permanentAddress || "-"}</p>
                    <p><strong>Temporary:</strong> {viewingWorker.temporaryAddress || "-"}</p>
                  </section>

                  <section className="operator-upload-card">
                    <h3>Phone Numbers</h3>
                    {(viewingWorker.phoneNumbers || []).length ? (
                      (viewingWorker.phoneNumbers || []).map((row, index) => (
                        <p key={`${row.phoneNumber}-${index}`}>
                          <strong>{row.label || (row.isPrimary ? "Primary" : `Phone ${index + 1}`)}:</strong> {row.phoneNumber}
                        </p>
                      ))
                    ) : (
                      <p>-</p>
                    )}
                  </section>

                  <section className="operator-upload-card">
                    <h3>Identity & Bank</h3>
                    <p><strong>Aadhaar:</strong> {viewingWorker.aadhaarNumber || "-"}</p>
                    <p><strong>Bank Account:</strong> {viewingWorker.bankAccountNumber || "-"}</p>
                    <p><strong>IFSC:</strong> {viewingWorker.ifscCode || "-"}</p>
                    {viewingWorker.aadhaarImageBase64 ? (
                      <img
                        className="operator-image-preview"
                        src={fileDataToUrl(viewingWorker.aadhaarImageBase64, viewingWorker.aadhaarImageMimeType)}
                        alt="Aadhaar"
                      />
                    ) : null}
                  </section>

                  <section className="operator-upload-card">
                    <h3>Resume</h3>
                    {viewingWorker.resumeFileBase64 ? (
                      <a
                        href={fileDataToUrl(viewingWorker.resumeFileBase64, viewingWorker.resumeFileMimeType)}
                        download={viewingWorker.resumeFileName || "resume"}
                      >
                        {viewingWorker.resumeFileName || "Download resume"}
                      </a>
                    ) : (
                      <p>-</p>
                    )}
                  </section>

                  <section className="operator-upload-card">
                    <h3>Other Proofs</h3>
                    {(viewingWorker.documents || []).filter((row) => row.category === "otherProof").length ? (
                      (viewingWorker.documents || [])
                        .filter((row) => row.category === "otherProof")
                        .map((row, index) => (
                          <div key={`proof-${index}`} className="operator-document-row">
                            <p><strong>{row.label || "Proof"}:</strong> {row.textValue || "-"}</p>
                            {row.fileDataBase64 ? (
                              <a href={fileDataToUrl(row.fileDataBase64, row.mimeType)} download={row.fileName || "proof-file"}>
                                {row.fileName || "Download file"}
                              </a>
                            ) : null}
                          </div>
                        ))
                    ) : (
                      <p>-</p>
                    )}
                  </section>

                  <section className="operator-upload-card">
                    <h3>Additional Details</h3>
                    {(viewingWorker.documents || []).filter((row) => row.category === "additionalDetail").length ? (
                      (viewingWorker.documents || [])
                        .filter((row) => row.category === "additionalDetail")
                        .map((row, index) => (
                          <div key={`detail-${index}`} className="operator-document-row">
                            <p><strong>{row.label || "Detail"}:</strong> {row.textValue || "-"}</p>
                            {row.fileDataBase64 ? (
                              <a href={fileDataToUrl(row.fileDataBase64, row.mimeType)} download={row.fileName || "detail-file"}>
                                {row.fileName || "Download file"}
                              </a>
                            ) : null}
                          </div>
                        ))
                    ) : (
                      <p>-</p>
                    )}
                  </section>
                </div>
              </div>
            ) : null}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
}
