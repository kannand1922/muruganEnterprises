import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonIcon,
  IonNote,
  IonPage,
  IonSpinner,
  useIonToast,
} from "@ionic/react";
import { printOutline } from "ionicons/icons";
import { useEffect, useMemo, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import { getPrinters, type Printer } from "../api/metaApi";
import {
  finishTodayUnfinished,
  printDifferenceByPersonReport,
  printDifferenceReport,
  printVerificationList,
  printVerificationReport,
} from "../api/stockApi";

const CURRENT_PRINTER_ID_KEY = "stocklens_current_printer_id";
type PrintActionKey =
  | ""
  | "all"
  | "unchecked"
  | "unmatched"
  | "matched"
  | "diff-today"
  | "diff-total"
  | "person-individual-today"
  | "person-common-today"
  | "person-individual-total"
  | "person-common-total";

function parsePositiveInt(rawValue: string | null) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

export function PrintPage() {
  const [presentToast] = useIonToast();
  const [rows, setRows] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPrinterId, setSelectedPrinterId] = useState<number | null>(null);
  const [printingKey, setPrintingKey] = useState<PrintActionKey>("");

  useEffect(() => {
    const stored = parsePositiveInt(localStorage.getItem(CURRENT_PRINTER_ID_KEY));
    if (stored) setSelectedPrinterId(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRows() {
      setLoading(true);
      try {
        const printers = await getPrinters();
        if (cancelled) return;
        setRows(printers);
        const stored = parsePositiveInt(localStorage.getItem(CURRENT_PRINTER_ID_KEY));
        const validStored =
          stored && printers.some((row) => row.id === stored) ? stored : null;
        const defaultPrinter = printers.find((row) => row.defaultPrinter) || null;
        const nextPrinterId = validStored || defaultPrinter?.id || null;
        setSelectedPrinterId(nextPrinterId);
        if (nextPrinterId) {
          localStorage.setItem(CURRENT_PRINTER_ID_KEY, String(nextPrinterId));
        }
      } catch (error) {
        if (cancelled) return;
        presentToast({
          message: error instanceof Error ? error.message : "Failed to load printers",
          color: "danger",
          duration: 1800,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadRows();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPrinter = useMemo(
    () => rows.find((row) => row.id === selectedPrinterId) || null,
    [rows, selectedPrinterId]
  );

  function onSelectPrinter(printer: Printer) {
    setSelectedPrinterId(printer.id);
    localStorage.setItem(CURRENT_PRINTER_ID_KEY, String(printer.id));
  }

  async function runPrintAction(action: "all" | "unchecked" | "unmatched" | "matched") {
    if (!selectedPrinterId) {
      presentToast({
        message: "Select printer first",
        color: "warning",
        duration: 1500,
      });
      return;
    }

    setPrintingKey(action);
    try {
      await finishTodayUnfinished();

      if (action === "all") {
        const result = await printVerificationReport({ printerId: selectedPrinterId });
        presentToast({
          message: result.message || "Print sent",
          color: "success",
          duration: 1800,
        });
      } else {
        const result = await printVerificationList({
          printerId: selectedPrinterId,
          filter: action,
        });
        presentToast({
          message: result.message || "Print sent",
          color: "success",
          duration: 1800,
        });
      }
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Print failed",
        color: "danger",
        duration: 2000,
      });
    } finally {
      setPrintingKey("");
    }
  }

  async function runDifferenceAction(
    mode: "stock" | "individual" | "common",
    scope: "today" | "total"
  ) {
    if (!selectedPrinterId) {
      presentToast({
        message: "Select printer first",
        color: "warning",
        duration: 1500,
      });
      return;
    }

    const key: PrintActionKey =
      mode === "stock"
        ? scope === "today"
          ? "diff-today"
          : "diff-total"
        : `person-${mode}-${scope}`;

    setPrintingKey(key);
    try {
      await finishTodayUnfinished();

      if (mode === "stock") {
        const result = await printDifferenceReport({
          printerId: selectedPrinterId,
          scope,
        });
        presentToast({
          message:
            result.message ||
            (scope === "today"
              ? "Today's stock difference printed"
              : "Whole-cycle stock difference printed"),
          color: "success",
          duration: 1800,
        });
      } else {
        const result = await printDifferenceByPersonReport({
          printerId: selectedPrinterId,
          mode,
          scope,
        });
        presentToast({
          message:
            result.message ||
            (mode === "individual"
              ? `Printed ${result.individualCount || 0} individual + 1 common (${scope})`
              : `Common person-wise report printed (${scope})`),
          color: result.partialFailure ? "warning" : "success",
          duration: 2200,
        });
      }
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Difference print failed",
        color: "danger",
        duration: 2200,
      });
    } finally {
      setPrintingKey("");
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Print" showBack backPath="/dashboard" />
      <IonContent fullscreen className="print-page-content ion-padding">
        <IonCard className="print-printers-card">
          <IonCardContent>
            <h2 className="print-printers-title">Available Printers</h2>
            {loading ? (
              <IonNote>Loading printers...</IonNote>
            ) : rows.length === 0 ? (
              <IonNote>No printers configured. Add printers from Settings.</IonNote>
            ) : (
              <div className="print-printers-list">
                {rows.map((row) => {
                  const selected = selectedPrinterId === row.id;
                  return (
                    <button
                      type="button"
                      key={row.id}
                      className={`print-printer-row ${selected ? "selected" : ""}`}
                      onClick={() => onSelectPrinter(row)}
                    >
                      <span className={`print-printer-radio ${selected ? "selected" : ""}`} />
                        <div className="print-printer-content">
                        <div className="print-printer-name">
                          {row.name.toUpperCase()}
                          {row.defaultPrinter ? " • DEFAULT" : ""}
                        </div>
                        <div className="print-printer-ip">
                          IP: {row.ipAddress}
                          {row.port ? `:${row.port}` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </IonCardContent>
        </IonCard>
        {selectedPrinter ? (
          <div className="print-selected-note">
            Selected: {selectedPrinter.name} ({selectedPrinter.ipAddress}:{selectedPrinter.port})
          </div>
        ) : null}

        <div className="print-action-list">
          <IonButton
            expand="block"
            className="print-action-btn"
            onClick={() => void runPrintAction("all")}
            disabled={Boolean(printingKey) || !selectedPrinterId}
          >
            {printingKey === "all" ? <IonSpinner name="crescent" /> : <IonIcon icon={printOutline} slot="start" />}
            PRINT ALL
          </IonButton>

          <IonButton
            expand="block"
            className="print-action-btn"
            onClick={() => void runPrintAction("unchecked")}
            disabled={Boolean(printingKey) || !selectedPrinterId}
          >
            {printingKey === "unchecked" ? (
              <IonSpinner name="crescent" />
            ) : (
              <IonIcon icon={printOutline} slot="start" />
            )}
            PRINT UNCHECKED
          </IonButton>

          <IonButton
            expand="block"
            className="print-action-btn"
            onClick={() => void runPrintAction("unmatched")}
            disabled={Boolean(printingKey) || !selectedPrinterId}
          >
            {printingKey === "unmatched" ? (
              <IonSpinner name="crescent" />
            ) : (
              <IonIcon icon={printOutline} slot="start" />
            )}
            PRINT UNMATCHED
          </IonButton>

          <IonButton
            expand="block"
            className="print-action-btn"
            onClick={() => void runPrintAction("matched")}
            disabled={Boolean(printingKey) || !selectedPrinterId}
          >
            {printingKey === "matched" ? (
              <IonSpinner name="crescent" />
            ) : (
              <IonIcon icon={printOutline} slot="start" />
            )}
            PRINT MATCHED
          </IonButton>
        </div>

        <div className="difference-actions-layout">
          <div className="difference-actions-section">
            <div className="difference-actions-title">Stock Difference</div>
            <div className="difference-actions-subtitle">
              Prints combined Shop + Godown difference.
            </div>
            <div className="difference-column-grid">
              <div className="difference-column-card today">
                <div className="difference-column-title">Today</div>
                <IonButton
                  expand="block"
                  onClick={() => void runDifferenceAction("stock", "today")}
                  disabled={Boolean(printingKey) || !selectedPrinterId}
                  className="difference-action-button stock-today"
                >
                  {printingKey === "diff-today" ? "Printing..." : "Stock Diff"}
                </IonButton>
              </div>
              <div className="difference-column-card whole-cycle">
                <div className="difference-column-title">Whole Cycle</div>
                <IonButton
                  expand="block"
                  onClick={() => void runDifferenceAction("stock", "total")}
                  disabled={Boolean(printingKey) || !selectedPrinterId}
                  className="difference-action-button stock-total"
                >
                  {printingKey === "diff-total" ? "Printing..." : "Stock Diff"}
                </IonButton>
              </div>
            </div>
          </div>

          <div className="difference-actions-section">
            <div className="difference-actions-title">Person-wise Difference</div>
            <div className="difference-actions-subtitle">
              Individual: one print per operator plus one common summary.
            </div>
            <div className="difference-column-grid">
              <div className="difference-column-card today">
                <div className="difference-column-title">Today</div>
                <IonButton
                  expand="block"
                  onClick={() => void runDifferenceAction("individual", "today")}
                  disabled={Boolean(printingKey) || !selectedPrinterId}
                  className="difference-action-button person-individual-today"
                >
                  {printingKey === "person-individual-today" ? "Printing..." : "Individual"}
                </IonButton>
                <IonButton
                  expand="block"
                  onClick={() => void runDifferenceAction("common", "today")}
                  disabled={Boolean(printingKey) || !selectedPrinterId}
                  className="difference-action-button person-common-today"
                  fill="outline"
                >
                  {printingKey === "person-common-today" ? "Printing..." : "Common"}
                </IonButton>
              </div>
              <div className="difference-column-card whole-cycle">
                <div className="difference-column-title">Whole Cycle</div>
                <IonButton
                  expand="block"
                  onClick={() => void runDifferenceAction("individual", "total")}
                  disabled={Boolean(printingKey) || !selectedPrinterId}
                  className="difference-action-button person-individual-total"
                >
                  {printingKey === "person-individual-total" ? "Printing..." : "Individual"}
                </IonButton>
                <IonButton
                  expand="block"
                  onClick={() => void runDifferenceAction("common", "total")}
                  disabled={Boolean(printingKey) || !selectedPrinterId}
                  className="difference-action-button person-common-total"
                  fill="outline"
                >
                  {printingKey === "person-common-total" ? "Printing..." : "Common"}
                </IonButton>
              </div>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
