import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ScrollView {
    id: root

    property string title: ""
    property var model: []
    property var theme

    clip: true
    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
    ScrollBar.vertical.policy: ScrollBar.AsNeeded

    function textColor(role) {
        if (theme && theme[role])
            return theme[role]
        return role === "textSecondary" ? "#657286" : "#1F2A37"
    }

    ColumnLayout {
        width: root.availableWidth
        spacing: 16

        Text {
            Layout.fillWidth: true
            text: root.title
            color: root.textColor("textPrimary")
            elide: Text.ElideRight
            font {
                family: "Microsoft YaHei UI"
                pixelSize: 20
                weight: Font.DemiBold
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: "#1F000000"
            opacity: 0.14
        }

        Repeater {
            model: root.model

            delegate: ColumnLayout {
                Layout.fillWidth: true
                spacing: 7

                Text {
                    Layout.fillWidth: true
                    text: modelData.label
                    visible: modelData.type !== "check"
                    color: root.textColor("textSecondary")
                    elide: Text.ElideRight
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 12
                        weight: Font.Medium
                    }
                }

                TextField {
                    id: textField
                    Layout.fillWidth: true
                    Layout.preferredHeight: 42
                    visible: modelData.type === "text" || modelData.type === "password"
                    text: bridge ? bridge.get_setting(modelData.key) || "" : ""
                    echoMode: modelData.type === "password" ? TextInput.Password : TextInput.Normal
                    selectByMouse: true
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 13
                    }
                    color: root.textColor("textPrimary")
                    placeholderTextColor: "#8A96A8"
                    onEditingFinished: {
                        if (bridge)
                            bridge.save_setting(modelData.key, text)
                    }
                    background: Rectangle {
                        radius: 10
                        color: textField.activeFocus ? "#F4FFFFFF" : "#70FFFFFF"
                        border.width: 1
                        border.color: textField.activeFocus ? "#6B8EFF" : "#72FFFFFF"

                        Behavior on color {
                            ColorAnimation { duration: 150 }
                        }
                    }
                }

                ComboBox {
                    id: combo
                    Layout.fillWidth: true
                    Layout.preferredHeight: 42
                    visible: modelData.type === "combo"
                    model: modelData.values || []
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 13
                    }

                    Component.onCompleted: {
                        var value = bridge ? bridge.get_setting(modelData.key) : ""
                        var idx = (modelData.values || []).indexOf(value)
                        currentIndex = idx >= 0 ? idx : 0
                    }

                    onActivated: {
                        if (bridge)
                            bridge.save_setting(modelData.key, currentText)
                    }

                    contentItem: Text {
                        text: combo.displayText
                        color: root.textColor("textPrimary")
                        elide: Text.ElideRight
                        verticalAlignment: Text.AlignVCenter
                        leftPadding: 14
                        rightPadding: 34
                        font {
                            family: "Microsoft YaHei UI"
                            pixelSize: 13
                        }
                    }
                    background: Rectangle {
                        radius: 10
                        color: combo.hovered ? "#F4FFFFFF" : "#70FFFFFF"
                        border.width: 1
                        border.color: combo.activeFocus ? "#6B8EFF" : "#72FFFFFF"
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    visible: modelData.type === "browse" || modelData.type === "file"
                    spacing: 10

                    TextField {
                        id: pathField
                        Layout.fillWidth: true
                        Layout.preferredHeight: 42
                        readOnly: true
                        text: bridge ? bridge.get_setting(modelData.key) || "" : ""
                        selectByMouse: true
                        color: root.textColor("textPrimary")
                        font {
                            family: "Microsoft YaHei UI"
                            pixelSize: 13
                        }
                        background: Rectangle {
                            radius: 10
                            color: "#70FFFFFF"
                            border.width: 1
                            border.color: "#72FFFFFF"
                        }
                    }

                    Button {
                        id: browseButton
                        Layout.preferredWidth: 82
                        Layout.preferredHeight: 42
                        text: "选择"
                        onClicked: {
                            var path = ""
                            if (bridge) {
                                path = modelData.type === "file"
                                    ? bridge.browse_file(modelData.fileKind || modelData.key)
                                    : bridge.browse_directory()
                            }
                            if (path) {
                                pathField.text = path
                                bridge.save_setting(modelData.key, path)
                            }
                        }
                        contentItem: Text {
                            text: browseButton.text
                            color: browseButton.hovered ? "#FFFFFF" : "#2E5AA7"
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                            font {
                                family: "Microsoft YaHei UI"
                                pixelSize: 13
                                weight: Font.DemiBold
                            }
                        }
                        background: Rectangle {
                            radius: 10
                            color: browseButton.hovered ? "#5B8DEF" : "#C8FFFFFF"
                            border.width: 1
                            border.color: "#84FFFFFF"

                            Behavior on color {
                                ColorAnimation { duration: 150 }
                            }
                        }
                    }
                }

                SwitchControl {
                    id: checkControl
                    Layout.fillWidth: true
                    visible: modelData.type === "check"
                    title: modelData.label
                    checked: bridge ? bridge.get_setting(modelData.key) === "1" : false
                    accentColor: "#3B82F6"
                    activeBackground: "#ECF4FF"
                    textColor: root.textColor("textPrimary")
                    mutedTextColor: root.textColor("textSecondary")
                    onToggled: function(value) {
                        if (bridge)
                            bridge.save_setting(modelData.key, value ? "1" : "0")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    visible: modelData.type === "slider"
                    spacing: 12

                    Slider {
                        id: slider
                        Layout.fillWidth: true
                        from: modelData.from || 10
                        to: modelData.to || 80
                        stepSize: 1
                        value: bridge ? parseInt(bridge.get_setting(modelData.key) || "40") : 40

                        onMoved: {
                            if (bridge)
                                bridge.save_setting(modelData.key, Math.round(value).toString())
                        }
                    }

                    Text {
                        Layout.preferredWidth: 34
                        text: Math.round(slider.value)
                        color: root.textColor("textSecondary")
                        horizontalAlignment: Text.AlignRight
                        font {
                            family: "Segoe UI"
                            pixelSize: 13
                            weight: Font.DemiBold
                        }
                    }
                }
            }
        }

        Item {
            Layout.fillHeight: true
            Layout.minimumHeight: 8
        }
    }
}
