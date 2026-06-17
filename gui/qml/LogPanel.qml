import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

GlassPanel {
    id: root

    property int maxLines: 5000

    cornerRadius: 22
    glassOpacity: 0.62
    tintColor: "#D8FFFFFF"

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 18
        spacing: 12

        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Rectangle {
                width: 8
                height: 8
                radius: 4
                color: "#24B47E"
                Layout.alignment: Qt.AlignVCenter
            }

            Text {
                text: "运行日志"
                color: "#243142"
                font {
                    family: "Microsoft YaHei UI"
                    pixelSize: 13
                    weight: Font.DemiBold
                }
            }

            Item { Layout.fillWidth: true }

            Text {
                text: "LIVE"
                color: "#6F7B8A"
                font {
                    family: "Segoe UI"
                    pixelSize: 10
                    letterSpacing: 0
                    weight: Font.Bold
                }
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: "#22000000"
            opacity: 0.12
        }

        Flickable {
            id: flick
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: width
            contentHeight: Math.max(height, ta.implicitHeight)
            boundsBehavior: Flickable.StopAtBounds

            ScrollBar.vertical: ScrollBar {
                policy: ScrollBar.AsNeeded
                width: 6
                contentItem: Rectangle {
                    radius: 3
                    color: "#55495A6A"
                }
                background: Rectangle {
                    radius: 3
                    color: "#14000000"
                }
            }

            TextArea {
                id: ta
                width: flick.width
                readOnly: true
                selectByMouse: true
                wrapMode: TextEdit.Wrap
                text: "等待启动...\n"
                color: "#263241"
                selectedTextColor: "#FFFFFF"
                selectionColor: "#5B8DEF"
                font {
                    family: "Cascadia Mono, Consolas"
                    pixelSize: 11
                }
                background: null

                onTextChanged: {
                    if (flick.contentHeight > flick.height)
                        flick.contentY = flick.contentHeight - flick.height
                }
            }
        }
    }

    function appendLine(line) {
        var next = line ? line.trim() : ""
        if (!next)
            return
        ta.text = ta.text + next + "\n"
        var lines = ta.text.split("\n")
        if (lines.length > maxLines)
            ta.text = lines.slice(-maxLines).join("\n")
    }
}
