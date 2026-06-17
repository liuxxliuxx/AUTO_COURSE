import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    anchors.fill: parent
    anchors.margins: 24

    property var theme
    property color statusNeutral: theme ? theme.textHint : "#8B96A5"

    signal startStopClicked()
    signal brushToggled(bool checked)
    signal transcribeToggled(bool checked)
    signal courseSelected(string url, string note)
    signal captchaConfirmClicked()

    RowLayout {
        anchors.fill: parent
        spacing: 18

        GlassPanel {
            Layout.preferredWidth: Math.min(520, Math.max(450, root.width * 0.48))
            Layout.fillHeight: true
            cornerRadius: 26
            glassOpacity: 0.7
            tintColor: "#E6FFFFFF"
            borderColor: "#9AFFFFFF"

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 24
                spacing: 16

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 4

                        Text {
                            Layout.fillWidth: true
                            text: "运行控制台"
                            color: theme ? theme.textPrimary : "#172033"
                            elide: Text.ElideRight
                            font {
                                family: "Microsoft YaHei UI"
                                pixelSize: 25
                                weight: Font.DemiBold
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            text: "课程、转写和验证码状态集中在这里"
                            color: theme ? theme.textSecondary : "#5F6C7B"
                            elide: Text.ElideRight
                            font {
                                family: "Microsoft YaHei UI"
                                pixelSize: 12
                            }
                        }
                    }

                    Rectangle {
                        Layout.preferredWidth: 58
                        Layout.preferredHeight: 58
                        radius: 18
                        color: "#ECF4FF"
                        border.width: 1
                        border.color: "#BFD7FF"

                        Text {
                            anchors.centerIn: parent
                            text: "AUTO"
                            color: theme ? theme.primary : "#3B82F6"
                            font {
                                family: "Segoe UI"
                                pixelSize: 11
                                weight: Font.Bold
                                letterSpacing: 0
                            }
                        }
                    }
                }

                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 76
                    radius: 20
                    color: "#72FFFFFF"
                    border.width: 1
                    border.color: "#86FFFFFF"

                    RowLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        spacing: 12

                        Rectangle {
                            Layout.preferredWidth: 42
                            Layout.preferredHeight: 42
                            radius: 14
                            color: "#EEF7F2"
                            border.width: 1
                            border.color: "#CFEBDD"

                            Rectangle {
                                anchors.centerIn: parent
                                width: 10
                                height: 10
                                radius: 5
                                color: statusIndicator.statusColor
                            }
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 3

                            Text {
                                text: "当前状态"
                                color: theme ? theme.textHint : "#8B96A5"
                                font {
                                    family: "Microsoft YaHei UI"
                                    pixelSize: 11
                                }
                            }

                            StatusIndicator {
                                id: statusIndicator
                                Layout.fillWidth: true
                                statusColor: root.statusNeutral
                            }
                        }
                    }
                }

                Item {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 68

                    PowerButton {
                        id: powerBtn
                        anchors.centerIn: parent
                        running: false
                        enabled: brushSwitch.checked || transcribeSwitch.checked
                        onClicked: root.startStopClicked()
                    }
                }

                Rectangle {
                    id: captchaBanner
                    Layout.fillWidth: true
                    Layout.preferredHeight: visible ? 50 : 0
                    visible: false
                    radius: 16
                    color: "#FFF3D6"
                    border.width: 1
                    border.color: "#F2C86D"
                    clip: true

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 14
                        anchors.rightMargin: 8
                        spacing: 10

                        Text {
                            text: "!"
                            color: "#9A6200"
                            font {
                                family: "Segoe UI"
                                pixelSize: 17
                                weight: Font.Bold
                            }
                        }

                        Text {
                            id: captchaText
                            Layout.fillWidth: true
                            color: "#704C11"
                            elide: Text.ElideRight
                            font {
                                family: "Microsoft YaHei UI"
                                pixelSize: 12
                                weight: Font.Medium
                            }
                        }

                        Button {
                            id: captchaButton
                            Layout.preferredWidth: 78
                            Layout.preferredHeight: 34
                            text: "完成"
                            onClicked: root.captchaConfirmClicked()
                            contentItem: Text {
                                text: captchaButton.text
                                color: "#FFFFFF"
                                horizontalAlignment: Text.AlignHCenter
                                verticalAlignment: Text.AlignVCenter
                                font {
                                    family: "Microsoft YaHei UI"
                                    pixelSize: 12
                                    weight: Font.DemiBold
                                }
                            }
                            background: Rectangle {
                                radius: 11
                                color: captchaButton.hovered ? "#A86B00" : "#8E5B00"
                                Behavior on color { ColorAnimation { duration: 140 } }
                            }
                        }
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Text {
                        text: "课程"
                        color: theme ? theme.textSecondary : "#5F6C7B"
                        font {
                            family: "Microsoft YaHei UI"
                            pixelSize: 12
                            weight: Font.Medium
                        }
                    }

                    ComboBox {
                        id: courseCombo
                        Layout.fillWidth: true
                        Layout.preferredHeight: 46
                        enabled: courseModel.count > 0
                        textRole: "display"
                        model: ListModel { id: courseModel }
                        onActivated: {
                            if (index >= 0 && index < courseModel.count) {
                                var item = courseModel.get(index)
                                root.courseSelected(item.url, item.note)
                            }
                        }

                        contentItem: Text {
                            text: courseCombo.enabled ? courseCombo.displayText : "暂无课程历史"
                            color: courseCombo.enabled ? (theme ? theme.textPrimary : "#172033") : "#8B96A5"
                            elide: Text.ElideMiddle
                            verticalAlignment: Text.AlignVCenter
                            leftPadding: 15
                            rightPadding: 36
                            font {
                                family: "Microsoft YaHei UI"
                                pixelSize: 13
                            }
                        }
                        background: Rectangle {
                            radius: 14
                            color: courseCombo.hovered ? "#F8FFFFFF" : "#84FFFFFF"
                            border.width: 1
                            border.color: courseCombo.activeFocus ? "#80A9FF" : "#8BFFFFFF"
                            Behavior on color { ColorAnimation { duration: 150 } }
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    SwitchControl {
                        id: brushSwitch
                        Layout.fillWidth: true
                        title: "刷课"
                        subtitle: "自动播放并记录学习时长"
                        accentColor: "#18A058"
                        activeBackground: "#EAF8F0"
                        checked: true
                        Component.onCompleted: {
                            checked = bridge ? bridge.get_setting("brush_enabled") !== "0" : true
                        }
                        onToggled: function(value) {
                            root.brushToggled(value)
                        }
                    }

                    SwitchControl {
                        id: transcribeSwitch
                        Layout.fillWidth: true
                        title: "转文字"
                        subtitle: "保存课程音频转写文本"
                        accentColor: "#3B82F6"
                        activeBackground: "#ECF4FF"
                        checked: false
                        Component.onCompleted: {
                            checked = bridge ? bridge.get_setting("transcribe_enabled") === "1" : false
                        }
                        onToggled: function(value) {
                            root.transcribeToggled(value)
                        }
                    }
                }

                Item { Layout.fillHeight: true }
            }
        }

        LogPanel {
            id: logPanel
            Layout.fillWidth: true
            Layout.fillHeight: true
        }
    }

    Component.onCompleted: {
        if (bridge)
            loadCourses(bridge.get_courses())
    }

    function loadCourses(items) {
        courseModel.clear()
        for (var i = 0; items && i < items.length; i++) {
            courseModel.append({
                "url": items[i].url || "",
                "note": items[i].note || "",
                "display": items[i].display || items[i].url || ""
            })
        }
        courseCombo.currentIndex = courseModel.count > 0 ? 0 : -1
    }

    function setRunning(state) {
        powerBtn.running = state
        statusIndicator.running = state
    }

    function setStatus(text, color) {
        statusIndicator.statusText = text
        statusIndicator.statusColor = color
    }

    function showCaptcha(hint) {
        captchaText.text = hint
        captchaBanner.visible = true
    }

    function hideCaptcha() {
        captchaBanner.visible = false
    }

    function appendLog(line) {
        logPanel.appendLine(line)
    }
}
